/** Official TF wordmark, with the original demo name retained. */
export function Logo() {
 return <span style={{display:"inline-flex",alignItems:"center",gap:14,color:"var(--ink)"}}>
  {/* Brand SVG is a static local asset; retain its original proportions and colours. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src="/brand/token-factory.svg" width="154" height="21" alt="Nebius Token Factory" />
  <span style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:22,letterSpacing:"-0.02em",borderLeft:"1px solid var(--line)",paddingLeft:14}}>Cutaway</span>
 </span>;
}
