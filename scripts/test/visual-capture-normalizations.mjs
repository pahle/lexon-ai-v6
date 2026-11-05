export function orderExactCaptureRows(body, orderedEmails, contentLabel) {
  const label = contentLabel ?? 'Review';
  if (!body || !Array.isArray(body.items)) {
    throw new Error(`${label} capture requires an items array.`);
  }
  if (!Array.isArray(orderedEmails) || orderedEmails.length !== 3) {
    throw new Error(`${label} capture requires its three indexed emails.`);
  }
  if (body.pageInfo?.nextCursor != null) {
    throw new Error(
      `${label} capture ordering applies only to an unpaginated response.`,
    );
  }

  const actualEmails = body.items.map((item) => item?.email);
  if (
    body.items.length !== orderedEmails.length ||
    actualEmails.some((email) => typeof email !== 'string') ||
    new Set(actualEmails).size !== actualEmails.length ||
    new Set(actualEmails).size !== orderedEmails.length ||
    orderedEmails.some((email) => !actualEmails.includes(email))
  ) {
    throw new Error(
      `${label} capture expected exactly the three indexed synthetic email rows.`,
    );
  }

  const rank = new Map(orderedEmails.map((email, index) => [email, index]));
  return {
    ...body,
    items: [...body.items].sort(
      (left, right) => rank.get(left.email) - rank.get(right.email),
    ),
  };
}
