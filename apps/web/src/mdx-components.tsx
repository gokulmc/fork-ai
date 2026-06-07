import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { AnchorHTMLAttributes } from 'react';

// Required by @next/mdx. Typography is handled by the `.post` CSS in the blog
// route; here we only route internal links through next/link and harden
// external links. Everything else passes through to plain semantic tags.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    a: ({ href = '', children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href.startsWith('/')) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      const external = href.startsWith('http');
      return (
        <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>
          {children}
        </a>
      );
    },
    ...components,
  };
}
