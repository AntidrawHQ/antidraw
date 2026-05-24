import { cn } from "@/renderer/lib/utils";
import { marked } from "marked";
import { memo, useId, useMemo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remend from "remend";
import { CodeBlock, CodeBlockCode } from "./code-block";

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
};

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext";
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : "plaintext";
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
      return (
        <span
          className={cn(
            "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
            className
          )}
          {...props}
        >
          {children}
        </span>
      );
    }

    const language = extractLanguage(className);

    return (
      <CodeBlock className={cn(className, "my-3 border-[#3a3a3a] bg-transparent")}>
        <CodeBlockCode
          code={children as string}
          language={language}
          theme="houston"
          className="[&>pre]:!bg-transparent"
        />
      </CodeBlock>
    );
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>;
  },
  hr: ({ node, ...props }) => (
    <hr className="!my-3 border-t border-[#3a3a3a]" {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote className="!border-[#3a3a3a]" {...props} />
  ),
  li: ({ node, ...props }) => (
    <li className="marker:!text-[#3a3a3a]" {...props} />
  ),
  table: ({ node, ...props }) => (
    <div className="not-prose my-4 overflow-x-auto rounded-sm border border-[#3a3a3a]">
      <table
        className="w-full border-collapse text-left text-sm"
        {...props}
      />
    </div>
  ),
  thead: ({ node, ...props }) => (
    <thead className="bg-white/5" {...props} />
  ),
  tbody: ({ node, ...props }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-white/[0.03]" {...props} />
  ),
  th: ({ node, ...props }) => (
    <th className="px-4 py-2.5 font-semibold text-white" {...props} />
  ),
  td: ({ node, ...props }) => (
    <td className="px-4 py-2.5 text-neutral-100" {...props} />
  ),
};

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string;
    components?: Partial<Components>;
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content;
  }
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;
  // remend self-heals mid-stream markdown (unclosed **bold, [link](, code fences).
  // For finished messages it's a no-op since input is already valid.
  const blocks = useMemo(
    () => parseMarkdownIntoBlocks(remend(children)),
    [children],
  );

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";

export { Markdown };
