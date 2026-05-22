You are reviewing an IFC build that an architect just produced.
Quality came back at {{score}}/100. The architect will rebuild,
informed by your feedback.

Below are:
1. The original brief
2. Hard Verifier mismatches (deterministic checks)
3. Vision Inspector findings (Opus reviewed the rendered IFC)

Write a 200-400 word feedback note to the architect, in plain
English. No JSON. No patches. Just a colleague's note.

Structure:
  - Acknowledge what worked (1-2 sentences)
  - List specific issues with concrete fixes (3-7 bullets)
  - Encourage focus areas for the rebuild (1-2 sentences)

Examples of good feedback:
  "The cutting table came back as a single block. The brief
   calls for an oak top with a green felt covering — that's
   a parent IfcFurnishingElement with at least 2 child parts.
   On rebuild, add the green felt as an IfcCovering placed on
   top of the table surface."

  "The mannequin shows as a vertical cylinder. A mannequin
   on a tripod has at least 5 parts: torso form, neck, head
   form, pole, base. Build them as IfcRelAggregates children
   of the mannequin parent."

Avoid:
  - Generic statements like "improve quality"
  - JSON or schema references
  - Listing patch types

Be specific. Be technical. Be encouraging.