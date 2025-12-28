export const ButtonShowcaseComponent: React.FC<
  React.HTMLAttributes<HTMLDivElement>
> = (props) => (
  <div {...props} className="bg-neutral-800 rounded-lg p-6">
    <h3 className="text-sm font-medium text-neutral-400 mb-4">
      Button Styles - Updated
    </h3>
    <div className="flex flex-wrap gap-3">
      <button className="px-4 py-2 bg-neutral-100 text-neutral-900 rounded-md font-medium hover:bg-neutral-200 transition-colors">
        Primary - Updated
      </button>
      <button className="px-4 py-2 border border-neutral-600 text-neutral-200 rounded-md font-medium hover:bg-neutral-700 transition-colors">
        Secondary
      </button>
      <button className="px-4 py-2 text-neutral-400 rounded-md font-medium hover:text-neutral-200 hover:bg-neutral-700 transition-colors">
        Ghost
      </button>
    </div>
  </div>
);
