import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import apiRefContent from '../../doc/API_REFERENCE.md?raw';

const mdComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold text-slate-900 mt-6 mb-4 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold text-slate-800 mt-8 mb-2 pb-1 border-b border-slate-200">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-slate-800 mt-6 mb-2">{children}</h3>,
  p: ({ children }) => <p className="text-slate-700 leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside text-slate-700 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-slate-700 mb-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="ml-2">{children}</li>,
  table: ({ children }) => <table className="w-full text-sm border-collapse border border-slate-200 mb-4">{children}</table>,
  thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
  th: ({ children }) => <th className="border border-slate-200 px-3 py-2 text-left font-medium text-slate-800">{children}</th>,
  td: ({ children }) => <td className="border border-slate-200 px-3 py-2 text-slate-700">{children}</td>,
  tr: ({ children }) => <tr>{children}</tr>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) return <code>{children}</code>;
    return <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>;
  },
  pre: ({ children }) => <pre className="bg-slate-100 border border-slate-200 rounded-lg p-4 overflow-x-auto text-sm mb-4">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-slate-300 pl-4 my-3 text-slate-600">{children}</blockquote>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  hr: () => <hr className="my-6 border-slate-200" />,
};

export function Doc() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-12">
      <article className="doc-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {apiRefContent}
        </ReactMarkdown>
      </article>
    </div>
  );
}
