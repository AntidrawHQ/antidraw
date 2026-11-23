import BoringAvatar from "boring-avatars";

const AVATAR_COLORS = ["#c084a0", "#84a0c0", "#a0c084", "#c0a084", "#84c0a0"];

type AvatarIconProps = {
  name: string;
  size: number;
};

export const AvatarIcon = ({ name, size }: AvatarIconProps) => (
  <div
    className="rounded shrink-0 overflow-hidden"
    style={{ width: size, height: size }}
  >
    <BoringAvatar
      size={size}
      name={name}
      variant="beam"
      colors={AVATAR_COLORS}
      square
    />
  </div>
);
