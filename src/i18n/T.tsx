import { Fragment, type ReactNode } from 'react';
import { t } from './index';

/**
 * A whole sentence with pieces of markup inside, translated as one sentence — word order
 * differs between languages, so never split a sentence into separate t() calls around a link
 * or a bold name.
 *
 *   <T text="Enter the code we sent to {email}." email={<b>{email}</b>} />
 */
export function T({ text, ...values }: { text: string } & Record<string, ReactNode>) {
  const out = t(text);
  const parts = out.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m && m[1] in values) return <Fragment key={i}>{values[m[1]]}</Fragment>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
