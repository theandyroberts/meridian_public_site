import Link from "next/link";

type BrandVariant = "horizontal" | "globe";

export function BrandArtwork({ size = 260, variant = "horizontal" }: { size?: number; variant?: BrandVariant }) {
  return <img className="brand-artwork" src={`/branding/plate-lab-${variant}.svg`} width={variant === "globe" ? 180 : 840} height={124} alt="" aria-hidden="true" style={{width:size,maxWidth:"100%",height:"auto"}} />;
}

export function Logo() {
  return <Link href="/" className="site-logo" aria-label="Plate Lab home"><BrandArtwork /></Link>;
}
