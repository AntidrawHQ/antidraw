export const CardComponent: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => (
  <div {...props} className="bg-neutral-800 rounded-lg p-6">
    <h2 className="text-xl font-semibold text-neutral-100 mb-2">Card Title</h2>
    <p className="text-sm text-neutral-400">
      This is a sample card component with a title and description. Perfect for
      displaying content in a contained, styled box.
    </p>
  </div>
);
