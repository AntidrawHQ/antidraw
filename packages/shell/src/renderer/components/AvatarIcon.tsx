import BoringAvatar from "boring-avatars";

const BORING_MONO = ["#1a1a1a", "#333333", "#555555", "#777777", "#999999"];

type AvatarIconProps = {
  name: string;
  size: number;
};

export const AvatarIcon = ({ name, size }: AvatarIconProps) => (
  <div
    className="rounded-full shrink-0 overflow-hidden flex items-center justify-center"
    style={{ width: size, height: size }}
  >
    <BoringAvatar
      size={size}
      name={name}
      variant="beam"
      colors={BORING_MONO}
      square={false}
    />
  </div>
);
