import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@/components/ui';

import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = { title: 'Create an account' };

export default function SignUpPage() {
  return (
    <Card>
      <h1 className="text-2xl font-extrabold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">
        Next you will choose a nickname and a profile picture. Prefer Google, GitHub or another
        provider?{' '}
        <Link
          href="/sign-in"
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          Use the sign-in page
        </Link>
        .
      </p>
      <SignUpForm />
    </Card>
  );
}
