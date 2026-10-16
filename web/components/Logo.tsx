import Link from "next/link";

type BrandVariant = "horizontal" | "stacked";

export function BrandArtwork({ size = 260, variant = "horizontal" }: { size?: number; variant?: BrandVariant }) {
  if (variant === "stacked") {
    return <img src="/branding/plate-lab-logo.jpeg" width={720} height={305} alt="" aria-hidden="true" style={{display:"block",width:size,maxWidth:"100%",height:"auto",mixBlendMode:"screen"}} />;
  }
  // Frame the supplied lockup tightly without modifying its original artwork.
  return <span className="brand-artwork-horizontal" style={{width:size}} aria-hidden="true"><img src="/branding/plate-lab-logo-horizontal.jpeg" width={1072} height={324} alt="" /></span>;
}

export function Logo({ variant = "horizontal" }: { variant?: BrandVariant }) {
  return <Link href="/" className="site-logo" aria-label="Plate Lab home"><BrandArtwork variant={variant} /></Link>;
}
