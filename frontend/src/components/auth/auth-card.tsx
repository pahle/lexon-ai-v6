import type { ReactNode } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../ui/card';
export function AuthCard({
  title,
  description,
  children,
  headingLevel = 1,
}: {
  title: string;
  description?: string | undefined;
  children?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <Heading
            className={
              headingLevel === 1
                ? 'text-[length:var(--font-size-heading)] leading-[1.5] font-semibold'
                : headingLevel === 2
                  ? 'text-2xl leading-[1.5] font-semibold'
                  : 'text-xl leading-[1.5] font-semibold'
            }
          >
            {title}
          </Heading>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">Lexon</p>
      </CardFooter>
    </Card>
  );
}
