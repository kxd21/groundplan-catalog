# Groundplan public equipment catalog

Shared A/V equipment records for [Groundplan](https://github.com/kxd21). Free,
public, and open to corrections.

A/V gear is not proprietary. A Barco projector is the same box in everyone's
warehouse, and a projector-shaped outline on a floor plan is the same outline
whoever drew it. Keeping that knowledge in one place means nobody is limited to
the gear they happen to have drawn themselves.

## What is in here

Each product carries what is true for everyone:

- manufacturer, brand, model, product name, category
- dimensions, weight, power requirements
- inputs, outputs, connections
- an **icon** — the plan-view outline, as pure geometry
- manuals, accessories, compatible equipment, replacement models
- tags

## What is deliberately not in here

Nothing about anybody's business, and nothing about anybody's clients.

Quantities owned, warehouse locations, barcodes, asset and serial numbers,
purchase and rental prices, maintenance history, damage status, availability
and show assignments all stay on the machine that recorded them. The
application keeps them in a different file that the update path cannot write.

Icons are geometry and nothing else. Every label, dimension and note is stripped
when an icon is extracted, and `build.mjs` **refuses to publish** any icon
containing a string of any kind. Names are checked too: anything naming a
customer, a venue, a room or a date is rewritten to describe the equipment
instead — `"BofA Podium"` becomes `"Podium"`.

## Contributing

Open a pull request against `products.json`. Corrections are as welcome as
additions — a wrong power figure or a wrong weight is worth more to fix than a
new record is to add.

A change is reviewed, merged, and included in the next release. Nothing reaches
an installed application without passing through a signed release, which is what
stops incorrect or malicious data being pushed straight to everyone.

## Releases

Every release is signed with an Ed25519 key whose public half is compiled into
the application. Installations verify the signature before trusting anything,
refuse packages whose contents do not match the hash in the signed manifest, and
refuse to move backwards to an older catalog than the one already installed.

Updates are incremental: an install on 1.0.0 downloads only what changed on the
way to 1.1.0. A full download happens only when there is no local catalog, it is
damaged, or the schema has changed.

```
manifest.json        signed; describes the release and every package in it
full.json            the whole catalog
from-<version>.json  only what changed since that version
```

Publishing a release:

```
git tag v1.1.0 && git push --tags
```

CI builds, signs and attaches the packages.

## Licence

Catalog data is released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) —
public domain. Use it for anything, including commercially, with or without
attribution. It came from the trade and it belongs to the trade.
