"""Parse Problem Radar's master-atlas.md into Stage 1 Research Brief JSON."""
import re, json, sys

FIELDS = {
    "Biblical references": "passages", "Biblical reference": "passages",
    "Biblical intervention": "biblical_intervention",
    "Underlying principle": "principle",
    "Modern problem": "modern_problem",
    "Possible modern solution": "modern_solution", "Possible solution": "modern_solution",
    "Product hypothesis": "product_hypothesis",
}

def parse_atlas(path):
    text = open(path, encoding="utf-8").read()
    entries = []
    for block in re.split(r"\n---\n", text):
        m = re.search(r"^## (\d+)\. (.+)$", block, re.M)
        if not m:
            continue
        e = {"id": int(m.group(1)), "topic": m.group(2).strip(),
             "slug": re.sub(r"\W+", "-", m.group(2).lower()).strip("-")}
        for label, key in FIELDS.items():
            f = re.search(rf"\*\*{label}:\*\*\s*(.+)", block)
            if f:
                e[key] = f.group(1).strip()
        e["needs_evidence"] = True  # evidence gate: stats must be added in Stage 2
        entries.append(e)
    return entries

if __name__ == "__main__":
    path = sys.argv[1]
    topic = sys.argv[2].lower() if len(sys.argv) > 2 else None
    entries = parse_atlas(path)
    if topic:
        entries = [e for e in entries if topic in e["topic"].lower()]
    print(json.dumps(entries, indent=2, ensure_ascii=False))
