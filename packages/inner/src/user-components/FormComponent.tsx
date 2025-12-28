import { useState } from "react";

export const FormComponent: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => {
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState("option1");
  const [checked, setChecked] = useState(false);

  return (
    <div {...props} className="bg-neutral-800 rounded-lg p-6 space-y-4">
      <h2 className="text-xl font-semibold text-neutral-100 mb-4">
        Input Form
      </h2>

      <div className="space-y-2">
        <label className="block text-sm text-neutral-400">Text Input</label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type something..."
          className="w-full px-3 py-2 bg-neutral-700 text-neutral-100 rounded border border-neutral-600 focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm text-neutral-400">Email Input</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="w-full px-3 py-2 bg-neutral-700 text-neutral-100 rounded border border-neutral-600 focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm text-neutral-400">Select</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full px-3 py-2 bg-neutral-700 text-neutral-100 rounded border border-neutral-600 focus:border-blue-500 focus:outline-none"
        >
          <option value="option1">Option 1</option>
          <option value="option2">Option 2</option>
          <option value="option3">Option 3</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="w-4 h-4 bg-neutral-700 border-neutral-600 rounded"
        />
        <label htmlFor="checkbox" className="text-sm text-neutral-400">
          Checkbox option
        </label>
      </div>

      <button
        type="button"
        onClick={() => alert(`Text: ${text}, Email: ${email}`)}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        Submit
      </button>
    </div>
  );
};
