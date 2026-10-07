// What plugin-react's Babel pass reprints: stamps must name the file as written.
export default function Shifted({ tags, x }: { tags: string[]; x: number }) {
  return (
    <div>
      <p>first line<br/>second <b>bold</b></p>
      <input disabled/><label>name</label>
      <i data-x={tags.length>0?'y':'n'}/><span>after</span>
      {
        x > 0
          ? <em>yes</em>
          : <s>no</s>
      }
    </div>
  )
}
