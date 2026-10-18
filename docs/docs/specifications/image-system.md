---
title: Image system specification
description: Visual identity, media paths, embedded metadata, gallery search, presentation, and jobs.
---

Image generation is attached to delivered turns. Text is shown first; a cancellable background image-author child can then make one or more illustrations for that exact timeline node. Canonical visual identity stays in story state and generated media stays on disk.

## Visual identity

Characters, locations and items may have a `visual_identity`. It contains only stable, provider-neutral facts:

```json
{
  "visual_identity": {
    "global_id": "person-mira",
    "description": "A slight woman with long black hair and grey eyes.",
    "tags": ["long black hair", "grey eyes", "slight build"],
    "negative_tags": ["blue eyes", "short hair"]
  }
}
```

`global_id` is optional and globally unique within a session. The description is required when the block is present. Current clothing, expression, activity, damage, lighting and surroundings are transient and do not belong in the identity.

At session creation authored identities are copied into the `visual_identities` table. An identity made or edited during play is session state and therefore follows snapshots and branches. Its version advances on every replacement or update. Generated images are not database rows.

Places and things have the same controls in their sheets: a picture generated from the saved visual identity, or a PNG brought without one (`/worlds/state/<place|thing>/image` and `/sessions/world/<place|thing>/image`, stored as the entity's reference image). The character editor exposes the same identity in both contexts. In the Worlds page it edits `visual_identity` in the character's JSON and generates the world's canonical portrait. In a live chat it edits the copied database identity and generates the session's portrait. Starting a session also hard-links (or copies across filesystems) the world's canonical entity references into the session, so the session is self-contained and later changes do not alter its source world.

## Files

Both a world folder and a session folder may be passed as the media root. Paths are stable:

```text
<root>/images/
  global/<global-id>/reference.png
  characters/<local-id>/reference.png
  locations/<local-id>/reference.png
  items/<local-id>/reference.png
  scenes/turn-<timeline-node>-<serial>.png
```

The `global/` namespace avoids collisions between global ids and the local `characters`, `locations`, `items` and `scenes` namespaces. A global id wins when an entity has both kinds of id. Otherwise a world uses its authored id and a session uses its numeric id.

Scene names use the timeline node (`n12`), not the displayed turn number: regeneration can reuse a turn number, while a timeline node is unique and stable. The final serial is two digits initially (`turn-n12-01.png`) and permits several images for one node.

Files are PNG because their metadata is embedded as a UTF-8 `iTXt` chunk named `dsh-roleplay`. The JSON (`dsh-roleplay-image/v2`) records its schema, purpose, creation time, effective and revised prompts, a standalone `description` of what the picture shows (a reference: the subject and its stable look; a scene: the established moment, then how each subject looks in it), `tags` (subject names and their stable visual traits, for finding the image again), provider, model, subjects and identity versions, and for scenes the turn, timeline node and optional narration segment. Images written before v2 have no description or tags and are still read (the gallery shows their prompt). A filesystem edit may replace a reference image at its stable path; metadata is useful provenance, not an index required to locate it.

Writes go to a temporary sibling and are atomically renamed. Reference generation replaces `reference.png`; scene generation uses a new serial and does not overwrite another scene image.

## Gallery

Every roleplay chat has a **Gallery** tab beside Chat and World: the images of the session's `images/` folder in a grid (filter: all, scenes, references), newest first. Opening one shows it large with its description, prompt, the provider's revised prompt, subjects, tags, model and the turn. `GET /roleplay-api/sessions/gallery?id=` lists the images with what each file says (`host/images/gallery.ts`, which reads the embedded metadata; a file without readable metadata is listed by its place), and `.../gallery/file?id=&path=` serves one by the path the listing gives, which must be a PNG inside `images/` and not reached through a link.

## Image presentation: reusing and bringing images

The agent that puts pictures in front of the player (`runImagePresenter`, prompt `roleplay/image-presenter`, formerly the image author) either **shows an image the session already has** or **has a new one generated**. Images come from two places:

- **Generated** by the story's image generation (`origin: generated`). The presenter says whether a scene image is `reusable`: true for a place, someone's lasting look or a repeatable mood, false (the default) for a one-off event. References are always reusable.
- **Brought by the person** (`origin: uploaded`): added with *Add images* in the Gallery, or put by hand in `<session>/images/library/` (a world's own `images/library/` is inherited by its sessions). They are always reusable, because otherwise they would only sit there. PNG, JPEG, WebP and GIF are accepted, recognised by their bytes. PNG carries its metadata inside; the other formats have a sidecar `<file>.json`.

Metadata is `dsh-roleplay-image/v3`: the v2 fields plus `origin`, `reusable`, `originalName` and, for a brought image, no prompt. A brought image starts without a description (`pending`). While `images.interpret` is on, a model that can read images describes it (`interpretImage`: a one-shot child shown the picture and the story's names; it writes `description`, `tags` and the `subjects` it clearly shows into the file). Describing runs in the background, one picture at a time, when an image is added, when the gallery is read, and before an automatic picture. A picture that fails stays pending and the Gallery shows why. The model is the chat's own, which must be declared `vision` in the provider, or `images.interpreterModel` (`provider/model`); a model not declared able to read images is refused rather than allowed to describe what it imagines. A model that only writes captions and cannot call tools can be set as `images.captioner`: it looks at the picture and writes plain text, and the chat's model (which sees no picture) turns that into the description, tags and subjects. The description can be corrected in the Gallery (*Edit*), which writes into the file.

**When a picture is needed on its own** (`images.mode` every-turn, `images.reuse` on) the presenter is given `search_images` and `use_existing_image` and told to look first. `search_images` returns the best candidates **with the pictures themselves** (when the agent's model can see: they are saved through the attachment service and ride in the tool result as image blocks; the OpenAI-compatible adapter sends the pictures of a tool result in a user message that follows the tool messages, since the API takes images nowhere else), so the agent judges each against the moment by looking, not only by description; a model that cannot see judges by description. `use_existing_image` accepts only an image that a search of this run returned, so every shown image was one the agent had the chance to judge, and its reason says what it saw.

Search joins two rankings by reciprocal rank. **Words**: how many of the query's words an image is described with, rarer words counting more (a word also matches one it begins; CJK is taken in pairs; function words are ignored), a subject of the image that the query names counting extra (a hint, not a filter: near matches are returned so the agent can look at them). **Meaning**, when an embedding service is there: the descriptions are embedded (as documents, in the background) into `images/.vectors.json`, made again only for a description that changed or a different model, and the query is compared by cosine similarity. If the service fails the words alone decide. The agent then chooses: it shows one image (`use_existing_image` writes `images/presented/<node>.json`, so nothing is copied and a rewind or branch keeps only the records of the turns it keeps) or generates. A picture the person asks for with the button is always generated. `images/.index.json` remembers what was read from each file, by size and time, so listing and searching read only files that are new or changed; both caches can be deleted at any time and the files remain the truth.

## Image author

`runImagePresenter` creates a child agent with no game-master or preset tools. Its stable persona separates canonical identity from scene-specific state and forbids inventing story facts. The caller supplies the current session, media root, turn and timeline node, an image generation service, and either a reference or transient request.

The child's dedicated tools are:

- `list_visual_subjects`: resolve the available characters, locations and items, including visible current state, stored visual identity and whether a reference exists.
- `set_visual_identity`: establish or explicitly correct an entity's stable identity.
- `generate_reference_image`: generate or replace that entity's canonical `reference.png`.
- `generate_transient_image`: generate a new immutable scene image with a collision-safe serial.

Generation requires a stored identity for every subject. Tool code—not the model—resolves ids and paths, combines canonical and transient prompts, writes metadata, and records the generated relative paths returned by the child. Hidden-item state is exposed so the author does not depict a concealed object merely because it exists in storage.

The reusable entry point is `@dsh-agentic-roleplay/core/images`.

## Turn integration

Every delivered output carries its stable timeline-node id. Chat settings choose `off`, `manual` (the default), or `every-turn`, and choose whether transient generation is text-only, prefers existing canonical references, or requires them. Required missing references are generated before the scene. Existing references are given to the provider as reference images in `ImageGenerationOptions.references`. The OpenAI-compatible provider uses `/images/edits` for such requests and `/images/generations` otherwise; LocalAI has no `/images/edits`, so its own provider (`dsh-ai-localai`) uses `/images/generations` with `files` (the first reference is repainted: image to image) or `ref_images` (models made for references), or leaves references out, as its `imageReferences` setting says; the default leaves them out because a model that does not take references can fail its backend on them.

**Hires fix.** `images.highRes` sets `ImageGenerationOptions.highRes` for the job's calls. A provider that can renders at the size asked, then repaints that result at a larger size (LocalAI: a second `/images/generations` call with the first result in `files`, `imageHighresScale` times the size rounded to multiples of 64, optionally `imageHighresSteps`); the composition is kept and detail is added. Providers that cannot ignore it. Verified live on LocalAI with Z-Image Turbo: 512 by 512 became 768 by 768.

`ImageJobs` runs at most one image author per session. A newer node or a rewind cancels the older job. A provider or author failure never holds back or invalidates the delivered text. Status is `absent`, `generating`, `ready` or `failed`; authenticated HTTP routes expose status, start/retry, and serve immutable PNGs. The transcript polls only while a job is running and offers manual generation, retry, and another image.

Branching hard-links canonical references and only the scene files belonging to inherited timeline nodes, falling back to copies across filesystems. Rewinding merely selects another timeline path; files are not removed.
