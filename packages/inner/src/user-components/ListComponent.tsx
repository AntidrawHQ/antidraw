export const ListComponent: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => (
  <div {...props} className="bg-neutral-800 rounded-lg p-6">
    <h3 className="text-lg font-semibold text-neutral-100 mb-4">Recent Activity</h3>
    <ul className="space-y-3">
      <li className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-sm text-neutral-300">Project files uploaded</span>
      </li>
      <li className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-sm text-neutral-300">Design review completed</span>
      </li>
      <li className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-yellow-400" />
        <span className="text-sm text-neutral-300">New comment on mockup</span>
      </li>
      <li className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-purple-400" />
        <span className="text-sm text-neutral-300">Team member joined</span>
      </li>
    </ul>
  </div>
);
