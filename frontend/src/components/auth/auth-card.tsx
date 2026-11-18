import type { ReactNode } from 'react';
import { AuthHeader } from './auth-parts';
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
  showBrandFooter = true,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  presentation?: 'card' | 'page';
  showBrandFooter?: boolean;
}) {
  const Heading = `h${headingLevel}` as const;
  const fallbackHeadingClass =
    headingLevel === 1
      ? 'font-serif text-3xl leading-[1.2] font-bold'
      : headingLevel === 2
        ? 'text-2xl leading-[1.5] font-semibold'
        : 'text-xl leading-[1.5] font-semibold';
  if (presentation === 'page')
    return (
      <section className="flex w-full flex-col gap-5">
        <AuthHeader
          title={title}
          description={description}
          headingLevel={headingLevel}
        />
        {children}
      </section>
    );
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <Heading className={fallbackHeadingClass}>{title}</Heading>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {showBrandFooter ? (
        <CardFooter>
          <p className="text-sm text-muted-foreground">Lexon</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
