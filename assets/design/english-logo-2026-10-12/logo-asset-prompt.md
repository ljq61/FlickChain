# FlickChain logo asset production

Selected direction: first concept, upper-left PRIMARY MARK from `01-tavern-letterpress.png`.

Produced with the built-in image_gen tool in transparent-background mode. The final selected asset is `public/branding/flickchain-logo.png` (1890 × 832 RGBA PNG). No post-generation pixel editing was applied.

Final source: `C:/Users/jackie.lu/.codex/generated_images/01a12fc9-ea51-70c3-9405-a7060f01b3c6/exec-6cfa9d58-941a-40d0-978e-106885f24c54.png`.

Alpha inspection: 983,416 fully transparent pixels. Visible content bounds (alpha >=16): x60–1839, y83–766. Most gold-face pixels use alpha253 (99.2% opacity). Low-alpha shadow/fringe pixels use alpha1–7; hidden RGB in alpha1 pixels can look colored in viewers that ignore alpha, but normal browser compositing makes them effectively invisible. There is no baked checkerboard background. Lettering reads exactly FlickChain.

Fidelity limitation: this is an AI-derived raster rendition of the selected concept rather than a pixel-identical crop. Brass edges and ornament strokes remain somewhat heavier than the approved board. Full letter shapes, coin, arcs, diamonds, and bottom flourishes are retained.

## First isolation prompt

Use case: background-extraction
Asset type: production PNG logo for the FlickChain tabletop game.
Input image 1 is the approved design board. Extract and reproduce ONLY its upper-left PRIMARY MARK as a clean isolated transparent logo. Match that specific mark faithfully, not the small-size mark, home mockup, or gameplay mockup.
Exact text (verbatim): "FlickChain" — uppercase F and C, other letters lowercase, spelled F-l-i-c-k-C-h-a-i-n. Preserve its distinctive broad vintage wedge-serif lettering, tall sweeping F, curved baseline, large central C, and delicately curled ending n. Cream-gold faces, warm brass shallow bevel, thin dark-brown dimensional edge/shadow: refined engraved/letterpress brass, restrained metallic texture. The center above the lettering has ONE round gold coin with two circular rim lines and softly brushed face. Two thin gently arched brass rules flank the coin symmetrically. A small four-point diamond sits below the coin and above the C. Under the lettering retain two sweeping thin tapered gold flourishes with their central four-point diamond, matching the reference.
Scene/backdrop: REAL fully transparent background with alpha. Every pixel outside the lettering, coin, rules, diamonds and tightly bounded shadows must be transparent, including counters of letters. No colored backdrop, no black panel, no white backdrop, no simulated checkerboard.
Composition/framing: one centered horizontal primary mark, roughly 2048 x 900 wide canvas. Keep the full flourishes and coin, about 3 percent clear margins; trim unnecessary empty space. Match original letter proportions, geometry and ornament spacing. Front-on, no perspective.
Constraints: Change only isolation/background and scale. No subtitle, no labels, no mockup, no UI, no extra words, no framing panel, no watermark, no second logo, no additional objects. Keep lettering legible at small size.

## Selected refinement prompt

Use case: background-extraction
Asset type: transparent production FlickChain logo.
Input image 1 is the approved design board: the upper-left PRIMARY MARK is the exact visual target. Input image 2 is the current isolated asset to refine.
Single targeted change: make the extrusion/bevel and ornament rules thin and shallow like image 1's PRIMARY MARK, reducing image 2's heavy 3D edging. Preserve exact "FlickChain" text, letter shapes, composition, one top coin, two top arcs, small diamond below coin, two under-flourishes and central diamond. The long rules/flourishes should be delicate single tapered gold strokes, not thick metallic tubing. Brass has cream-gold faces with subtle shallow bevel and tight dark-brown shadow, as in image 1; keep it sharp and refined. Do not flatten into monochrome.
Preserve real transparent alpha background, with absolutely no backdrop, panel, checkerboard or colored edge halo. Fully transparent outside the logo and letter counters. Front-on horizontal mark, no perspective, one centered mark, at least 3% empty clear transparent margin on all sides and no clipped ornaments or shadows. No subtitle, no labels, no UI, no extra text, no watermark. Wide canvas about 2048x900.
