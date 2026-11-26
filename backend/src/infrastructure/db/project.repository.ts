import { z } from 'zod';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ProjectRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly matterNumber: string | null;
  readonly practiceArea: string | null;
  readonly memberCount: number;
  readonly chatCount: number;
  readonly lastActivityAt: Date;
  readonly createdAt: Date;
}

export interface ProjectView extends ProjectRecord {
  readonly access: 'owner' | 'editor' | 'viewer' | 'none';
  readonly instructions: string | null;
}

interface ProjectRow {
  id: string;
  owner_user_id: string;
  name: string;
  matter_number: string | null;
  practice_area: string | null;
  member_count: number;
  chat_count: number;
  last_activity_at: Date;
  created_at: Date;
}

interface ProjectViewRow extends ProjectRow {
  access: ProjectView['access'];
  instructions: string | null;
}

export interface ProjectMemberRow {
  user_id: string;
  role: 'viewer' | 'editor';
  created_at: Date;
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    matterNumber: row.matter_number,
    practiceArea: row.practice_area,
    memberCount: row.member_count,
    chatCount: row.chat_count,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  };
}

function mapView(row: ProjectViewRow): ProjectView {
  return {
    ...mapProject(row),
    access: row.access,
    instructions: row.instructions,
  };
}

/**
 * Every read goes through the 0043 policies plus the claim-bound
 * `ops.lexon_project_access` arm, so a non-member, a denied member and a
 * missing project are the same empty result — the identical-404 contract.
 * Member writes lean on the owner-with-check policies; an RLS refusal (42501)
 * reaches the service as a pg error, which it maps to a validation failure.
 */
export class ProjectRepository {
  async insert(
    tx: TenantSession,
    input: {
      id: string;
      name: string;
      matterNumber?: string | undefined;
      practiceArea?: string | undefined;
    },
  ): Promise<ProjectView> {
    if (!uuid.safeParse(input.id).success) throw new Error('Invalid project');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid project owner');
    const result = await client.query<ProjectViewRow>(
      `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,practice_area)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING *,NULL::text AS access,NULL::text AS instructions`,
      [
        input.id,
        ctx.orgId,
        ctx.userId,
        input.name,
        input.matterNumber ?? null,
        input.practiceArea ?? null,
      ],
    );
    // The access definer scans app.projects, which a same-statement RETURNING
    // call cannot see — the level resolves in this follow-up statement.
    const access = await this.access(tx, input.id);
    return { ...mapView(result.rows[0]!), access };
  }

  /**
   * The caller's standing on the project — 'none' for non-members, denied
   * members, nonexistent projects and the org-admin metadata arm, which the
   * Matters list must not leak into the member view.
   */
  async access(
    tx: TenantSession,
    projectId: string,
  ): Promise<'owner' | 'editor' | 'viewer' | 'none'> {
    if (!uuid.safeParse(projectId).success) return 'none';
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return 'none';
    const result = await client.query<{ access: ProjectView['access'] }>(
      `SELECT ops.lexon_project_access($1,$2,$3) AS access`,
      [ctx.orgId, projectId, ctx.userId],
    );
    return result.rows[0]?.access ?? 'none';
  }

  async find(
    tx: TenantSession,
    projectId: string,
  ): Promise<ProjectView | null> {
    if (!uuid.safeParse(projectId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<ProjectViewRow>(
      `SELECT p.*,ops.lexon_project_access(p.org_id,p.id,$2) AS access,
         i."text" AS instructions
       FROM app.projects p
       LEFT JOIN app.project_instructions i
         ON i.org_id=p.org_id AND i.project_id=p.id
       WHERE p.org_id=$1 AND p.id=$3
         AND ops.lexon_project_access(p.org_id,p.id,$2)<>'none'`,
      [ctx.orgId, ctx.userId, projectId],
    );
    return result.rows[0] ? mapView(result.rows[0]) : null;
  }

  async list(
    tx: TenantSession,
    input: {
      filter: 'all' | 'owned' | 'shared';
      sort: 'name' | 'activity';
      cursor: { key: string; id: string } | null;
      limit: number;
    },
  ): Promise<ProjectView[]> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const filter =
      input.filter === 'owned'
        ? `AND p.owner_user_id=$2`
        : input.filter === 'shared'
          ? `AND p.owner_user_id<>$2`
          : '';
    const order =
      input.sort === 'name' ? 'p.name,p.id' : 'p.last_activity_at DESC,p.id';
    const cursorClause = input.cursor
      ? input.sort === 'name'
        ? `AND (p.name,p.id)>($4,$5)`
        : `AND (p.last_activity_at,p.id)<($4::timestamptz,$5)`
      : '';
    const params: unknown[] = [ctx.orgId, ctx.userId, input.limit];
    if (input.cursor) params.push(input.cursor.key, input.cursor.id);
    const result = await client.query<ProjectViewRow>(
      `SELECT p.*,ops.lexon_project_access(p.org_id,p.id,$2) AS access,
         NULL::text AS instructions
       FROM app.projects p
       WHERE p.org_id=$1
         AND ops.lexon_project_access(p.org_id,p.id,$2)<>'none'
         ${filter} ${cursorClause}
       ORDER BY ${order}
       LIMIT $3`,
      params,
    );
    return result.rows.map(mapView);
  }

  async updateSettings(
    tx: TenantSession,
    projectId: string,
    input: {
      name?: string | undefined;
      matterNumber?: string | null | undefined;
      practiceArea?: string | null | undefined;
    },
  ): Promise<ProjectView | null> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const sets: string[] = ['updated_at=clock_timestamp()'];
    const params: unknown[] = [ctx.orgId, projectId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(clause.replace('?', `$${params.length}`));
    };
    if (input.name !== undefined) push('name=?', input.name);
    if (input.matterNumber !== undefined)
      push('matter_number=?', input.matterNumber);
    if (input.practiceArea !== undefined)
      push('practice_area=?', input.practiceArea);
    const result = await client.query<ProjectViewRow>(
      `UPDATE app.projects SET ${sets.join(',')}
       WHERE org_id=$1 AND id=$2
       RETURNING *,ops.lexon_project_access(org_id,id,$${params.length + 1}) AS access,
         NULL::text AS instructions`,
      [...params, ctx.userId],
    );
    return result.rows[0] ? mapView(result.rows[0]) : null;
  }

  async setInstructions(
    tx: TenantSession,
    projectId: string,
    instructions: string | null,
  ): Promise<void> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return;
    if (instructions === null) {
      await client.query(
        `DELETE FROM app.project_instructions
         WHERE org_id=$1 AND project_id=$2`,
        [ctx.orgId, projectId],
      );
      return;
    }
    await client.query(
      `INSERT INTO app.project_instructions
         (org_id,project_id,"text",updated_by_user_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (org_id,project_id)
       DO UPDATE SET "text"=EXCLUDED."text",
         updated_by_user_id=EXCLUDED.updated_by_user_id,
         updated_at=clock_timestamp()`,
      [ctx.orgId, projectId, instructions, ctx.userId],
    );
  }

  async listMembers(
    tx: TenantSession,
    projectId: string,
  ): Promise<ProjectMemberRow[]> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const result = await client.query<ProjectMemberRow>(
      `SELECT user_id,role,created_at FROM app.project_members
       WHERE org_id=$1 AND project_id=$2 ORDER BY user_id`,
      [ctx.orgId, projectId],
    );
    return result.rows;
  }

  async member(
    tx: TenantSession,
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberRow | null> {
    if (!uuid.safeParse(userId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<ProjectMemberRow>(
      `SELECT user_id,role,created_at FROM app.project_members
       WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
      [ctx.orgId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async addMember(
    tx: TenantSession,
    projectId: string,
    input: { userId: string; role: 'viewer' | 'editor' },
  ): Promise<ProjectMemberRow> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid member write');
    const result = await client.query<ProjectMemberRow>(
      `INSERT INTO app.project_members(org_id,project_id,user_id,role)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (org_id,project_id,user_id)
       DO UPDATE SET role=EXCLUDED.role,updated_at=clock_timestamp()
       RETURNING user_id,role,created_at`,
      [ctx.orgId, projectId, input.userId, input.role],
    );
    return result.rows[0]!;
  }

  async updateMemberRole(
    tx: TenantSession,
    projectId: string,
    userId: string,
    role: 'viewer' | 'editor',
  ): Promise<ProjectMemberRow | null> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<ProjectMemberRow>(
      `UPDATE app.project_members
       SET role=$4,updated_at=clock_timestamp()
       WHERE org_id=$1 AND project_id=$2 AND user_id=$3
       RETURNING user_id,role,created_at`,
      [ctx.orgId, projectId, userId, role],
    );
    return result.rows[0] ?? null;
  }

  async removeMember(
    tx: TenantSession,
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberRow | null> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<ProjectMemberRow>(
      `DELETE FROM app.project_members
       WHERE org_id=$1 AND project_id=$2 AND user_id=$3
       RETURNING user_id,role,created_at`,
      [ctx.orgId, projectId, userId],
    );
    return result.rows[0] ?? null;
  }

  async listChats(
    tx: TenantSession,
    projectId: string,
  ): Promise<{ id: string; title: string; updated_at: Date }[]> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const result = await client.query<{
      id: string;
      title: string;
      updated_at: Date;
    }>(
      `SELECT id,title,updated_at FROM app.chats
       WHERE org_id=$1 AND project_id=$2 AND deleted_at IS NULL
       ORDER BY last_activity_at DESC,id`,
      [ctx.orgId, projectId],
    );
    return result.rows;
  }
}
