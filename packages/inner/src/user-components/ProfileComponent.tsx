export const ProfileComponent: React.FC<
  React.HTMLAttributes<HTMLDivElement>
> = (props) => (
  <div {...props} className="bg-neutral-800 rounded-lg p-6 flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-neutral-600 flex items-center justify-center">
      <span className="text-lg font-semibold text-neutral-300">JD</span>
    </div>
    <div>
      <h3 className="text-lg font-semibold text-neutral-100">Jane Doe</h3>
      <p className="text-sm text-neutral-400">Product Designer</p>
    </div>
  </div>
);
