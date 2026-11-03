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
  presentation = 'card',
}: {
  title: string;
  description?: string | undefined;
  children?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  presentation?: 'card' | 'page';
}) {
  const Heading = `h${headingLevel}` as const;
  const inAuthFrame = presentation === 'page';
  const content = (
    <>
      <header className="flex flex-col items-center gap-1 text-center">
        <Heading
          className={
            inAuthFrame
              ? 'font-serif text-2xl font-bold'
              : headingLevel === 1
                ? 'text-[length:var(--font-size-heading)] leading-[1.5] font-semibold'
                : headingLevel === 2
                  ? 'text-2xl leading-[1.5] font-semibold'
                  : 'text-xl leading-[1.5] font-semibold'
          }
        >
          {title}
        </Heading>
        {description ? (
          <p
            className={
              inAuthFrame
                ? 'text-sm text-balance text-muted-foreground'
                : 'text-sm text-muted-foreground'
            }
          >
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </>
  );
  const fallbackHeadingClass =
    headingLevel === 1
      ? 'text-[length:var(--font-size-heading)] leading-[1.5] font-semibold'
      : headingLevel === 2
        ? 'text-2xl leading-[1.5] font-semibold'
        : 'text-xl leading-[1.5] font-semibold';
  if (inAuthFrame)
    return <section className="flex w-full flex-col gap-6">{content}</section>;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <Heading className={fallbackHeadingClass}>{title}</Heading>
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
