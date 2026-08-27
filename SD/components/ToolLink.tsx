import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { recordToolUse } from '../lib/userTools';

type ToolLinkProps = Omit<LinkProps, 'to'> & { toolId: string };

export const ToolLink: React.FC<ToolLinkProps> = ({ toolId, onClick, children, ...props }) => (
  <Link
    {...props}
    to={`/tool/${encodeURIComponent(toolId)}`}
    onClick={(event) => {
      recordToolUse(toolId);
      onClick?.(event);
    }}
  >
    {children}
  </Link>
);

export default ToolLink;
