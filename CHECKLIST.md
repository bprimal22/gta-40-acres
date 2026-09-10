# Campus Explorer — current development checklist

The current default is **Google Photorealistic 3D Tiles through Cesium ion**, restored at the user's request after they rejected the local-only appearance. `?offline=1` retains the optional local campus without provider calls. Preserve the photographic baseline; the local-only work below records a separate mode, not final visual acceptance.

## Tower planting grade 82 — local scene verified

- [x] Trace the angular banks to nearest-walkway height switches in authored planting soil; blend the adjacent grade and share the ground material with the Will C. Hogg yard.
- [x] Preserve 370 of 374 mesh position buffers, building/paving geometry, 245 sampled route heights, collider count and horizontal tree placements. Verify 195 soil samples against Rapier support.
- [x] Pass TypeScript, typed lint and production build. Replay both beds, stairs, jump/landing, tree approach/retreat, descent to Speedway and scooter ride/dismount; all 26 final browser samples have zero tile errors.
- [x] Save a [before/after comparison](../research/tower-yard-grade-82/comparison.html) and [evidence with performance limits](../research/tower-yard-grade-82/README.md). Public release 81 remains unchanged.
- [ ] Reconstruct the actual low planter walls and planting density; refine remaining terrace skirts/source foliage and fix incorrect Tower-approach location labels. Stable full-campus 60 FPS and final realism remain unverified.

## Friends release 81 — GTA 40 Acres is live

- [x] Publish the accepted photographic build to [gta40acres.pages.dev](https://gta40acres.pages.dev/) on personal Cloudflare Pages Free; preserve visitor-owned tokens and the local development credentials.
- [x] Correct the immutable HTTP cache rule for stable model/texture filenames; pass the static build, authentication/cache checks, credential scan, and 98 public content-file hash comparisons.
- [x] Create the explicitly approved asset- and URL-restricted verification token, expiring October 8, 2026. Verify actual public photographic rendering, walk/run/jump, scooters, map travel, Tower approach ascent/descent, character view, reload and token removal/reconnection.
- [x] Save the exact release ZIP, production deployment ID, sampled browser state and screenshots in [release 81 evidence](../research/friends-demo/release-81/README.md). All recorded gameplay samples have zero tile errors.
- [ ] Continue visual fidelity, wider route coverage and frame pacing; release success does not complete the full-campus realism goal.

## Map arrival 80 — integrated and replayed in the photographic game

- [x] Isolate the original 27.56 m Schoch arrival offset in the authored scene; preserve the capsule-clearance rejection while searching nearby outdoor ground.
- [x] Pass 12 native safety/transform/controller checks, authored-scene walk/run/jump cases, TypeScript, typed lint and isolated/integrated production builds.
- [x] Replay an identical browser map click from the same spawn: offset improves from 25.83 m to 0.75 m. Walk/run the Schoch stairs, check the doorway, retreat and jump/land.
- [x] Verify exact clear-ground arrival, cancellation preserving departure, expanded-map PCL outdoor fallback, tree approach/retreat and East Mall–Speedway–Tower approach ascent/descent. Twenty-one recorded samples have zero tile errors; final warning/error log is empty. [Evidence and limits](../research/map-arrival-80/README.md).
- [x] Resolve the testing access misunderstanding: browser-only in-app controls work independently of the locked native-app inventory. No unlock or OS security change was needed.
- [ ] Continue campus visual fidelity and route coverage; investigate distorted PCL source foliage and the incorrect-looking Tower approach location label. Full-campus 60 FPS and final realism are not established.

## Historic window coverings 79 — integrated, full visual goal open

- [x] Compare Schoch/Rapoport reference photos and same-camera game screenshots; introduce varied coverings behind existing glass on 105 window openings.
- [x] Preserve all existing geometry buffers, collider count, material batches and photographic source cuts; add approximately 0.92 MiB of window attributes.
- [x] Pass TypeScript, focused lint and production build. Replay MLK–East Mall–Speedway walking/running, jump/landing, Tower approach stair ascent/descent and lateral facade inspection with actual browser inputs.
- [x] Save a portable [before/after comparison](../research/historic-window-coverings-79/comparison.html), screenshots, sampled browser states and [verification notes](../research/historic-window-coverings-79/README.md).
- [ ] Continue improving the flat-looking authored foreground. This material change does not establish full-campus photorealism.

## Schoch facade iteration 78 — integrated, full visual goal open

- [x] Prepare photo-informed south windows, doorway and stairs in an isolated candidate; preserve the normal photographic game.
- [x] Pass candidate TypeScript, 200 rendered/physical surface comparisons and eight native stair walking/running routes. Other buildings, the Schoch roof and photographic source cuts are unchanged.
- [x] Integrate and inspect the photographic root at walking height. Refine bright block-shaped stair cheeks into muted concrete with continuous sloping curbs.
- [x] Replay actual walking/running on both stair lanes, jump/landing, doorway approach/retreat, tree navigation, west entrance and photographic overview. [Change and evidence](../research/schoch-facade-78/README.md).
- [x] Isolate and fix the map-arrival offset in iteration 80; matched browser click now resolves 0.75 m away while open East Mall selection remains exact.
- [ ] Improve the remaining flat-looking foreground facades; tile availability alone does not establish photographic appearance at walking height.

## Iteration 76 — photographic source investigation

- [x] Confirm the normal root page streams photographic tiles; distinguish tile availability from the simplified authored foreground.
- [x] Compare Schoch/Rapoport reference photos and source-only views with the playable replacements.
- [x] Reject upper scan retention after visible facade holes, and reject regional reflections after dark-window regressions.
- [x] Restore all 204 runtime source files to iteration 75. Verify mesh, material ownership, collider, source-cut and landscape preservation.
- [x] Replay walking/running, jump/landing, tree collision/retreat, map travel, Tower stairs, GDC and overview using actual browser controls. Exact results: [iteration 76 evidence](evidence/iteration-76/README.md).
- [ ] Improve East Mall's building-specific entrance, facade texture and small-pane details; neither rejected experiment counts as that work.
- [x] Build and verify the free Cloudflare friends demo, preserving photographic imagery and keeping visitor tokens in their browser; completed in release 81 above.

## Iteration 75 — inexpensive diagnostics and corrected performance evidence

- [x] Profile actual browser standing/riding with and without per-frame snapshots before changing code.
- [x] Identify the exact skinned-character bounds scan as the dominant observer cost: roughly 56–61ms per snapshot.
- [x] Make normal snapshots omit that scan and return null bounds; preserve explicit `includeCharacterBounds: true` inspection and standalone precise pose diagnostics.
- [x] Reduce observed snapshot cost to roughly 0.5–0.6ms without changing visual assets, terrain, collision rules or locomotion.
- [x] Verify nine real-GLB pose cases: identical transforms/contacts/bounds, zero skinned-vertex reads in the lightweight mode, and precise bounds preserved on request.
- [x] Pass TypeScript, changed-file typed lint and production build; replay scooter travel/dismounts, walking/running, jump/landing, Gregory and Tower stairs, door contact/retreat and MLK map arrival.
- [x] Record a fresh 121-sample GPU window, 16 final walking/running targets and photographic view with 170 visible tiles and zero errors. Final stationary frame median/p95: 16.7/20.8ms. Close the owned browser and retain the HTTP 200 local server. [Evidence](evidence/iteration-75/README.md).
- [x] Correct the interpretation of older snapshot-heavy replay timings: they include the expensive diagnostic scan and are not direct measurements of uninstrumented gameplay.
- [ ] Continue full-campus visual fidelity, loading/frame pacing and remaining route acceptance. Typical warmed riding is near the 60fps target, but a consistent full-campus 60fps result is not established.

## Iteration 74 — Gregory north lower frontage

- [x] Keep photographic streaming as default, the in-play offline recovery action, optional local scene and accepted player.
- [x] Compare three saved north-frontage photos and source-height/ray probes; reconstruct pale lower masonry, eight recessed windows, three paired stair groups and closed upper doorway recesses.
- [x] Replace the source folds that blocked doorway approaches; preserve the upper brick facade and roof and all other building mesh records.
- [x] Reproduce the narrow-tread uphill crawl with the actual controller; widen each run from 5.45m to 6.0m and extend the eastern backing floor.
- [x] Pass 24 native walking/running ascent/descent cases, 2,600 surface checks, 24 window rays, finite geometry and seven-batch disposal checks.
- [x] Preserve 364 existing mesh records and local-only constructor records; trim only overlapping WCP paving/Gregory soil. Retain 267 old corridor probes and the recorded 5.13mm seam discrepancy.
- [x] Pass TypeScript, changed-file typed lint and production build.
- [x] Complete the final live 31-target stair/forecourt replay, all six flights in both directions, three door contact/retreat checks and run/jump/landing.
- [x] Complete 37 final browser targets, both corridor scooter crossings/dismounts, Tower stairs and MLK map arrival. Final view: 170 photographic tiles, zero errors. Close the owned browser, retain HTTP 200 local server and archive [iteration 74 evidence](evidence/iteration-74/README.md).
- [ ] Resolve frame-pacing limits: final stationary median/p95 interval 16.7/58.2ms; instrumented ride samples were about 100ms apart and diagnostic overhead remains unisolated. No overall performance improvement is claimed.
- [ ] Improve the upper photographic facade/roof, source-to-custom transitions, exact ornament and remaining wider campus visuals/routes. This is an incremental local checkpoint.

## Iteration 73 — Gregory north outdoor path

- [x] Preserve photographic default, optional local mode and the accepted player; retain iteration 72's in-play scenery recovery button.
- [x] Use saved Gregory/WCP photographs and UT tree inventory; replace damaged outdoor scan with supported brick/concrete/planting surfaces and simple seating.
- [x] Protect the Gregory stair/frontage apron, preserve building mesh records and add lower ground backing beneath source holes.
- [x] Move the old entrance-blocking trunk to inventory site 5004; retain its collider and verify east/west scooter crossings.
- [x] Verify 267 floor samples, nine root heights, unchanged 356 existing mesh records, bounded cuts and identical local-only constructor records.
- [x] Pass TypeScript, changed-file typed lint and production build.
- [x] Complete nine actual browser walking/running targets, jump/landing, planter contact/retreat, Tower stairs, MLK arrival and a supported northbound Speedway ride. Final view: 167 photographic tiles, zero tile errors.
- [x] Record fresh before/after GPU windows, close the owned browser and leave the HTTP 200 server running. [Evidence](evidence/iteration-73/README.md).
- [ ] Repair Gregory's warped lower facade and verify its actual entrance stairs; resolve remaining source holes and wider campus fidelity/performance.
- [ ] Investigate dismount refusal near x=-8.055,z=148.838. Keep the 5.13mm exact shared-edge sampling discrepancy recorded; east/west live crossings passed.

## Iteration 71 — WCP western architecture

- [x] Preserve photographic default, optional local mode, the player and iteration 70's repaired WCP ground.
- [x] Obtain and inspect architect photographs, north-marked floor plans and sections; match the Speedway end and north wall before assigning details.
- [x] Split the three-level limestone western wing from the lower glazed connector; add grouped recessed windows, dark corner panels, small shades and a low hipped roof.
- [x] Fit the north doorway threshold to the retained yard independently of the building datum.
- [x] Verify 1,024 facade ray samples and 1,444 floor samples, finite geometry, roof normals, both constructors, unchanged non-WCP meshes/source cuts/trees and disposal.
- [x] Pass TypeScript, changed-file typed lint and production build.
- [x] Complete 19 final browser targets, fitted doorway and west-wall contact/retreat, jump, both scooter crossings, Speedway return, Tower stairs and memorial spawn. Final view: 164 photographic tiles, zero tile errors. Fresh performance and screenshots: [iteration 71](evidence/iteration-71/README.md).
- [ ] Refine the courtyard portal, exact bays/materials, eastern WCP masses, terrace furniture and landscaping. Repair adjacent folded source foliage and continue full-campus acceptance.

## Iteration 70 — WCP paving and Speedway connection

- [x] Keep photographic tiles as the default and the accepted character unchanged.
- [x] Remove the false WCP west-yard ledge by using the Speedway/MLK grade on both sides of X=0; preserve all building datums and source cuts.
- [x] Remove only overlapping generic grass/registration seams, with matching rendered and physical surfaces.
- [x] Pass 72 supported native walking/running/scooter routes with zero unsupported frames; preserve 16 out-of-coverage probes as failures.
- [x] Verify 1,444 floor samples, zero new degeneracies, unchanged other buildings/trees/materials/source cuts, both scene constructors and disposal.
- [x] Complete 18 final browser targets, WCP jump, both scooter crossings, Speedway return, Tower stairs and memorial spawn; final view has 137 photographic tiles and zero tile errors.
- [x] Pass TypeScript, changed-file typed lint and production build.
- [ ] Finish WCP architectural/landscape likeness, source-dependent outer connections and the remaining campus visual/route work.

Browser results and performance: [iteration 70](evidence/iteration-70/README.md). The existing tree at the north crossing remains a physical obstacle; use the open southern crossing. This is an incremental ground repair, not final realism acceptance.

## Iteration 69 — Waggener upper facade and roof

- [x] Preserve photographic default; final pedestrian view has 178 visible tiles and zero tile errors.
- [x] Compare the UT and Barera reference photos against the game; restore the missing brick window level, limestone attic band and higher pitched roof.
- [x] Add continuous soffits, curved eave brackets, frame surrounds, shallow corner courses and downpipes. Keep the existing west/east doorway datums.
- [x] Compare source roof heights: RMS vertical difference improves from 3.59m to 0.35m on 32 common samples. Explicitly retain the extra observation outside the mapped eave as unresolved registration.
- [x] Preserve all 347 other mesh records, every ground/tree record and existing texture loads. Extend only the two WAG cuts upward; keep all 4,331 other cuts identical.
- [x] Verify finite geometry, zero degenerate triangles, 567 render/physics roof-area samples, ownership/disposal, both scene constructors and all 48 native movement cases.
- [x] Complete 29 final browser walking/running targets, WAG and Tower stairs, two scooter crossings, jumps, closed-door contact/retreat and camera turns beside the facade.
- [x] Pass TypeScript, changed-file typed lint and production build. Record fresh before/after GPU windows; no performance improvement or sustained 60FPS claim.
- [ ] Refine roof lateral registration, exact bay grouping, brick/glass response, medallions and inscriptions. Current geometry is still a reference-informed approximation.
- [ ] Resolve the retained WCP/WAG grade problems, outer source foliage, CBA approach and off-paving scooter readiness observation; complete broader campus fidelity and route acceptance.

Evidence: [iteration 69](evidence/iteration-69/README.md). Local incremental checkpoint; no publication or full-campus visual acceptance.

## Iteration 68 — Speedway crossings and Garrison/Waggener ground

- [x] Keep photographic scenery as the default and offline scenery optional. The final normal view has 203 visible photographic tiles and zero tile errors.
- [x] Repair the depressed Speedway planting edge, its thin floor slit and overlapping BRB grass without changing the golden paving or building geometry.
- [x] Replace damaged exterior foliage within the supported Garrison/Waggener footprint; use the same closed surfaces for rendering and collision.
- [x] Connect Waggener's west entrance to its plaza with short steps, using the UT reference photograph and observed source floors. The doorway elevation remains an approximation.
- [x] Add four existing-asset trees at inventory centers, match their roots to the ground and verify trunk contact/retreat. Preserve every prior tree center.
- [x] Preserve all 3,283 existing GAR soil triangle records and all 4,162 original source cuts; add 171 bounded replacement cuts and keep subsequent seam rebuilds outside the new floor.
- [x] Preserve the separate offline terrain/building arrangement; the new Garrison/Waggener region is photographic-mode only.
- [x] Pass the combined geometry/ownership/disposal checks, 48 exact-game native movement cases, TypeScript, changed-file typed lint and the production build.
- [x] Reach 39 browser walking/running targets across the main and final regression replays, including both prior Garrison blockages, WAG west stairs and the existing GAR north stairs; verify jump/landing.
- [x] Complete nine recorded scooter crossings/rides with zero unsupported frames, including both directions on the actual golden Speedway paving. Retain small controller corrections and the separate failed grass-route observation.
- [x] Cross the western/northern boundaries and return from the outer southern stopping point. Retain its incomplete target as a failure, not a successful crossing.
- [ ] Resolve the retained raised WCP paving at Z120–122 and the steep WAG south/east return before accepting those scooter routes.
- [ ] Diagnose the off-paving scooter readiness stop near X1.24,Z96.58 and the outer southern target near CBA. One earlier mount refusal recovered after source collision preparation.
- [ ] Repair damaged source foliage outside this footprint and improve approximate facades, broader campus routes and sustained performance.

Evidence: [iteration 68](evidence/iteration-68/README.md). Local incremental checkpoint; no publication or full-campus visual acceptance.

## Iteration 67 — Garrison grade and exposed foundation

- [x] Retain photographic default; normal east baseline has 206 visible tiles and zero tile errors.
- [x] Diagnose the artificial 6.22 m berm as distant-stair height extrapolation. Fit a continuous lower garden to measured source floors and keep the west courtyard elevated.
- [x] Add closed retaining edges and 17 entrance steps; use the actual unchanged north doorway datum.
- [x] Extend only the GAR foundation to Y10.094 and add four recessed east basement windows; gate out buried north openings.
- [x] Prove the lower foundation fits existing cuts, all 3,345 unrelated soil triangles are unchanged, and only GAR/soil mesh buffers change. Preserve original source cuts, materials, textures, hedges and 136 previous trees.
- [x] Replace visible soil and its collider together, then resample three changed garden root heights. Preserve both west-tree heights and all five centers/scales.
- [x] Pass 20 native walk/run routes, six scooter crossings, two true-stair scooter rejections, finite geometry, Three/Rapier checks, TypeScript, changed-file typed lint and production build.
- [x] Walk the corrected east/south garden and north service path in the browser; ascend/descend the entrance and replay the outer-north return and jump/landing.
- [x] Ride the repaired east boundary both directions and walk the southern source join. Ride the established Speedway/MLK crossing north and south.
- [x] Iteration 68 repairs and replays the approach near X=-82.7,Z108.7, the retained source boundary near X=-116.5,Z132, and the separate Speedway border stop at X=-0.36,Z76.13. The original iteration 67 failure evidence remains unchanged.
- [ ] Replace damaged exterior photographic foliage, refine retained northern slopes and complete campus-wide architecture/performance/route acceptance.

Evidence: [iteration 67](evidence/iteration-67/README.md). Local incremental build; no publication. The original 66 archive remains unchanged; the fixture correction above is current interpretation.

## Iteration 66 — Garrison planting and leaf rendering

- [x] Preserve Google/Cesium photographic default and the explicit local-only alternative.
- [x] Add five supported trees around Garrison: four saved inventory centers and one inferred companion; reuse existing GLBs and one asset owner.
- [x] Match the entire basal wood footprint to retained soil; keep crowns/low wood clear of conservative building and path envelopes.
- [x] Preserve all 351 static mesh buffers/transforms, 339 static colliders, source cuts, hedges and all 136 existing placements; add five actual trunk colliders only.
- [x] Correct the exact RGB leaf asset's unnecessary transparent double-pass; retain maps, colors, geometry and collision transforms.
- [x] Pass TypeScript, changed-file typed lint, production build and native placement/material/physics checks. Repository-wide lint still has 519 diagnostics in untouched/vendor/evidence files.
- [x] Reach all twelve garden walking targets; test trunk contact/retreat, camera orbit and jump/landing.
- [x] Cross Speedway by scooter both directions with zero unsupported or blocked-reason frames; preserve walking access to the first Tower flight.
- [x] Record fresh before/leaf-only/final GPU windows and draw counts, without claiming a campus-wide frame-rate improvement.
- [x] Finish with200 visible photographic tiles and zero tile errors; close only the owned test browser and retain the HTTP200 local server.
- [ ] Repair the still-visible damaged scan boundary and approximate garden slopes; five trees do not solve those defects.
- [x] Iteration 67 corrected this diagnosis: the outer-north failure came from excessive downward movement in the native fixture. Exact game motion and actual browser replay both pass; no live collision fix was needed.
- [ ] Complete broader architecture, sustained performance and full-campus route acceptance.

Evidence: [iteration 66](evidence/iteration-66/README.md). Local incremental build; no publication.

## Iteration 65 — ground materials and photographic coverage inspection

- [x] Preserve photographic default and restore it after the explicit raw survey; final walking view has 199 visible tiles and zero tile errors.
- [x] Replace MLK procedural gravel and plain concrete with four optimized local photo-derived maps; retain source records and concrete joints.
- [x] Improve legacy Mall and MLK lawns using the existing grass texture and muted dry/live variation.
- [x] Preserve all 351 mesh buffers/transforms, the complete 339-collider authored world, source cuts and tree/hedge placements.
- [x] Pass TypeScript, typed lint, production build, combined material/geometry and profiler lifecycle checks.
- [x] Reach 18 walking targets, jump/land, climb/descend the first Tower flight and return continuously to MLK through Speedway.
- [x] Reach both scooter crossing targets with zero unsupported frames; document one small southbound controller correction.
- [x] Correct an initial test heading that drove into the tree verge, without removing the obstacle.
- [x] Add GPU-window provenance and collect fresh samples with a lighter observer; preserve different draw counts and measurement caveats.
- [x] Compare repaired/raw Garrison garden views and 21 high/low columns; reject a simple canopy reveal because its underside is broken ribbons.
- [x] Close only the owned isolated browser; keep the local server responding HTTP 200.
- [ ] Improve garden shape, convincing canopy and shade with bounded reference-guided work.
- [ ] Complete broader architecture, sustained performance and full-campus route acceptance.

Evidence: [iteration 65](evidence/iteration-65/README.md). Local incremental build; no publication.

## Iteration 64 — historic masonry and roofs, with photographic scenery retained

- [x] Preserve photographic default; final browser snapshot shows 175 visible tiles and zero tile errors.
- [x] Compare saved building photographs and actual before/candidate/final views; distinguish warmer buff/salmon brick from pale limestone.
- [x] Reuse existing material textures and retain all 43 historic mesh batches, 9 materials, physical geometry, source cuts and entrances.
- [x] Orient 20 hip-roof slopes by metres along/down each roof; align tile color/relief and filter fine detail at distance.
- [x] Pass TypeScript, typed lint, production build and combined live material/geometry checks.
- [x] Reach all 17 final walking targets, run the mapped Speedway bends approximately 132 m each way, jump/land, and climb/descend the first Tower flight.
- [x] Verify both scooter crossing recordings with zero unsupported or blocked frames; preserve the earlier entrance collision approach/retreat.
- [x] Record and correct a test route that mistakenly entered a tree verge; retain the obstacle and replay the actual paving route.
- [x] Close only the owned isolated browser and keep the local server running.
- [ ] Improve legacy flat yards and lost photographed canopy using bounded, reference-guided changes.
- [ ] Isolate the slower GPU/frame samples and improve sustained frame pacing; no performance-neutrality or 60 FPS claim.
- [ ] Complete full-campus architectural accuracy and route acceptance.

Evidence: [iteration 64](evidence/iteration-64/README.md). Local incremental build; no publication.

## Iteration 63 — preserve photographic scenery and refine the foreground

- [x] Keep Google/Cesium photographic tiles as the default and local-only as an explicit option.
- [x] Compare historic facades with reference photos; replace the green-painted pane response on EPS, BRB, JGB, WAG and GAR with dark interiors and existing-sky specular highlights.
- [x] Reduce hemisphere fill's cyan bias while preserving sun, exposure and tile colors; inspect the intermediate lighting-only view.
- [x] Reproduce the Speedway–East Mall scooter stop; remove one overlapping soil batch only where existing golden paving supports it.
- [x] Verify native scooter/foot crossings, preserved Tower stair stops and the existing local terrain; keep terrain/road assets unchanged.
- [x] Replay the repaired crossing both directions in photographic mode using distance targets; verify walking, running, jumping, the first Tower stair flight, camera orbit and map travel.
- [x] Pass final TypeScript, configured typed lint and production build.
- [x] Complete the optional-local browser replay with external requests blocked: both scooter crossing directions, braking/dismounting and jump/landing pass; 357 game requests stay on localhost with no tile/config requests.
- [ ] Complete photographic materials, roof/detail variation, sustained frame pacing and the full-campus route matrix. Current facades still contain visible approximations.

Evidence: [iteration 63](evidence/iteration-63/README.md). No publication; preserve the photographic default for subsequent passes.

## Iteration 61 — local scenery coverage and engineering ground

- [x] Restore mapped road/path finishes with explicit asphalt/concrete tags and shared golden Speedway material; use three local batches with no extra colliders.
- [x] Complete the Main Building body, seven roof zones and recessed windows while preserving entrances, Tower and both courtyard holes.
- [x] Close PMA's low podium/foundation and add recessed windows without changing its towers.
- [x] Expose existing EER paving through backed ground-mask registration; fit the north connection and remove unnecessary numerical clipping seams.
- [x] Verify 750 road/physical-ground comparisons, final terrain fixtures, Main geometry/entrance checks, TypeScript, typed lint and production build.
- [x] Run continuously along Speedway to Hackerman and west24th, then jump/land. Ride Speedway, west24th, PMA, EER and Dean asphalt.
- [x] Run and ride the EER north connection both ways; stop a scooter at real Tower stairs, then dismount and walk up/down.
- [x] Keep provider startup absent; use an isolated browser with external HTTP blocked and localhost available.
- [ ] Resolve the unchanged southwest EER authored return failure and complete the wider campus route matrix.
- [ ] Complete missing local buildings, DKR stadium body, photographic materials and full-campus performance/visual acceptance.

Evidence: [iteration 61](evidence/iteration-61/README.md). This is an incremental local build; no publication or claim of final realism.

## Iteration 60 — local runtime, scooter access and engineering approaches

- [x] Remove provider startup/configuration requests; old config endpoint returns410 without reading credentials.
- [x] Refresh mutable development modules through the local service worker; reproduce and correct stale-runtime sidewalk testing.
- [x] Verify normal local boot with zero external and zero tile-configuration requests.
- [x] Correct false scooter stops at modest paving lips; keep real stairs and walls solid. Replay Speedway, 24th and Tower stair dismount/walk in local mode.
- [x] Clear four nearest EER trees and construct the PMA forecourt; retain local contour ground along Dean after removing the obsolete scan-specific sidewalk candidate.
- [x] Integrate GDC north facade/neck, POB low connector/roof, court connection and glass refinement.
- [x] Fill background ground with a versioned local terrain bake; remove Float32 collision slivers and replay the exact Tower failure in both directions.
- [x] Verify external-network-blocked play, TypeScript, focused lint and production build.
- [ ] Deliver a packaged server-stopped offline app; current Vite development build requires localhost available.
- [ ] Replace missing former photographic coverage with detailed local assets and finish full-campus visual/route acceptance.

Evidence: [iteration 60](evidence/iteration-60/README.md). Local development only; no publication.

## Iteration 59 — GDC, POB and DKR pedestrian refinement

- [x] Integrate three agents' bounded building, material and entrance packages into the shared scene.
- [x] Improve Gates–Dell masonry variation and rebuild POB south/upper facades; compare matched views and remove measured upper-wall scan fragments.
- [x] Repair the north-road gap, northwest approach and south-cap return; replay the original failures, both directions, running and the shared-apron turn.
- [x] Connect DKR's center and side entrance lanes; replay approaches, retreat and jumping.
- [x] Correct active-tile ground queries; verify the production constructor and replay Tower stairs, East Mall and GDC after the shared change.
- [x] Run Speedway approximately 144 m each direction; verify jump/landing and overview return. Final 23 walking targets pass.
- [x] Pass final TypeScript, focused lint, production build, 1,545 authored facade comparisons and 16 live ground comparisons.
- [ ] Improve POB's low connector, neighboring eastern scan fragments, flat/repetitive materials and farther stadium canopy geometry.
- [ ] Complete full-campus visual and continuous-route acceptance, sustained streaming and performance tests.

Evidence and exact source snapshot: [iteration 59](evidence/iteration-59/README.md). This is a local incremental build, not final photorealistic acceptance.

## Iteration 58 — additional architecture and entrance connections

- [x] Integrate three agents’ photo-informed PCL, PMA, POB and DKR packages with one shared scene owner.
- [x] Rebuild the PCL north porch with complete graded support; replay three doorway lanes and east stairs.
- [x] Add grouped PMA tower bays/service core and POB stepped facades/yard; inspect matched views and replay approaches.
- [x] Add DKR west facade bays, recessed stair entrance and bounded graded forecourt; verify a real center entrance/exit route.
- [x] Reproduce and remove the EPS soil overlap blocking Speedway; replay normal walking and approximately 144 m running in both directions.
- [ ] Finish remaining PMA low podium/surroundings and farther DKR canopy. Iteration 59 addresses the inspected north POB fragments and western side-lane street connection.
- [ ] Bring close materials, reflections, neighboring source boundaries and full-campus routes to final realism acceptance.

Detailed checks, screenshots and limitations: [iteration 58](evidence/iteration-58/README.md).

## Cesium / real-campus integration

- [x] Read and use the verified Cesium handoff without exposing the token in source or logs.
- [x] Pin 3d-tiles-renderer 0.5.2; stream Google Photorealistic 3D Tiles inside the existing Three.js game.
- [x] Integrate streamed imagery with selected authored foreground repairs; retain explicit raw-scan and procedural comparisons.
- [x] Convert Earth-centered coordinates to local east/up/south meters; analytically check origin, axes, vertical displacement, scale and handedness.
- [x] Wait for a stable starting surface and align its vertical reference before enabling entry.
- [x] Keep live Google Maps attribution visible; share one tileset between walking and overview modes.
- [x] Add nearby streamed-mesh collisions and retire old collision LODs after replacements are installed.
- [x] Playtest an approximately 120 m route along 24th Street, including running, a jump/landing, camera orbit and a building approach.
- [x] Capture canopy and shaded-entrance defects instead of claiming the imagery resolves eye-level realism.
- [x] Initially calibrate at the verified clear street section (120, -133); iteration 38 moves arrival to MLK/East Mall while retaining that separate calibration anchor.
- [x] Add V for a campus overview and scroll zoom.
- [x] Verify TypeScript, focused lint and the production compilation; verify private-file and cross-origin config requests are rejected.
- [ ] Replay the full Tower, Union, GDC/Speedway, PCL, engineering and DKR walking network with the streamed environment. Earlier procedural-route results do not establish current tile collision correctness.
- [ ] Resolve blocked real paths, warped stairs/entrances and camera obstructions caused by the scanned geometry.
- [ ] Establish a detailed pedestrian visual standard using suitable independently authored/owned assets where the scan is soft or incomplete.
- [x] Replace the armored character with a rigged civilian and test idle/walk/run, jump and contact shadow.
- [x] Integrate a complete human character inspired by the user's video, with dark hair, white Longhorn cap and front/side/back review controls.
- [x] Accept the current player per user feedback; pause further character refinement while scenery is the priority.
- [ ] Test sustained streaming, weak-network behavior, LOD transitions and memory pressure across the full campus.
- [ ] Configure the intended hosted URL and production client configuration, then publish a sufficiently complete milestone. Current delivery is local.

## Evidence and limits

### Iteration 57 — two landmark finishes and rideable scooter

- [x] Compare matching live views and retain deeper NHB lower-window shading and broader, quieter Texas Union limestone. Preserve all building/ground collision geometry.
- [x] Add F mount/dismount, W throttle, A/D steering and S/Space braking, capped at 9.6 m/s; retain the accepted character, with hands/feet fitted to the scooter.
- [x] Replace unusably expensive ground scans with a verified triangle index; preserve ground/collision equivalence, disposal and changing tile geometry.
- [x] Verify actual acceleration, left/right steering, independent camera, braking, moving dismount, focus/map stops, map arrival on foot, foot jump/landing, both stair directions and the continuous East Mall return.
- [x] Pass final TypeScript, focused lint and production build; retain 38 clearance, 15 recovery and authored-campus route fixtures plus reference/source hashes. Full-project lint is not claimed green.
- [ ] Reduce occasional cold indexing/streaming hitches and improve distorted scans opposite Hackerman, other campus approaches, material variation and reflections. Full-campus realism remains incomplete.

Evidence: `evidence/iteration-57/README.md`. Warm frame samples do not establish sustained campus-wide performance. Local delivery only.

### Iteration 56 — Welch west path and roof, Hackerman materials

- [x] Rebuild 45.55 m of graded Welch west forecourt and a separate 16.8 m² planting repair, preserving existing stairs, the western entrance and 24th borders.
- [x] Reproduce an invisible streamed seam collision with the actual measured triangle; add narrow source clearance over supported ground and replay the same junction successfully.
- [x] Replace bounded high Welch roof folds with closed mechanical-roof geometry, six fans and a small verified perimeter correction; preserve lower surfaces and document the 1.085 m GIS/scan uncertainty.
- [x] Improve NHB buff brick, limestone and glass using existing shared textures/sky; reject the first overly dark glazing trial and verify resource ownership.
- [x] Walk/run the northern stairs, west path, planting edge and return loop in Chrome; verify actual-wall contact/retreat plus jump/landing. All final walking endpoints grounded, keys released and imagery errors zero.
- [x] Pass final TypeScript, focused lint and production build; retain 1,545 facade comparisons and targeted ground, collision, source-removal and disposal checks. Full-project lint is not claimed green.
- [ ] Improve remaining flat lower glass, uniform masonry, courtyard/other scan remnants and sustained streaming. The twenty-building inventory remains an architectural first pass.
- [x] Implemented in iteration 57 after this stable scenery checkpoint; design handoff is `../research/scooter-design-2026-09-07/HANDOFF.md`. No riding runtime is included in 56.

Evidence: `evidence/iteration-56/README.md`, including rejected comparisons, actual failed/fixed inputs, source hashes and timing limits. Local delivery only.

### Iteration 55 — northern Welch connection and hedge rendering

- [x] Extend the supported Welch foreground 42.2 m to the fixed 24th border; add two photo-informed stair branches, a terrace and rails while preserving Speedway.
- [x] Remove measured scan fragments only over the supported strip; raise the initial 15 m ceiling to 16.2 m after two residual blades were observed. Keep the original failures and frozen inputs.
- [x] Preserve static/dynamic ground cleanup, reseat simple trees, and pass 14 live ground groups including 7,788 supported controller frames, repeated seam updates and ownership teardown.
- [x] Walk both stairs down/up, run the northern ascent and the 24th connection, and return through the old middle-yard seam in the browser. Capture final jump/landing and GDC hedge contact/retreat/jump-on-top.
- [x] Reject oversized hedge leaves and box-shaped cores in actual close-ups; retain small leaf clusters in 14 spatial batches with unchanged 264 colliders. Final hedge regression passes 11 groups; authored hedge triangles are 36% below the original.
- [x] Pass TypeScript, focused changed-file lint, production build, 1,545 facade comparisons and the existing 13 middle-yard groups. Full-project lint still reports unrelated archived/vendor/UI issues; no whole-repository lint pass is claimed.
- [x] Audit apparent PCL furniture burial and high Welch roof ownership; preserve evidence showing the furniture's lower terrace and avoid an unnecessary ground patch.
- [ ] Repair western gap/high-roof and PCL scan distortions; improve close building materials and sustained streaming performance. The first twenty buildings remain an architectural pass rather than photorealistic completion.

Evidence: `evidence/iteration-55/README.md`. Reference-based estimates, rejected variants, actual input replay, timing limits and source hashes are retained.

### Iteration 54 — regional architecture, local glass and Welch ground

- [x] Extend Welch’s middle Speedway facade by approximately 68 m and Gates–Dell’s south exterior by 47.6 m using inspected photos and official footprints; record inferred dimensions.
- [x] Replace the adjoining Welch yard with supported graded ground; preserve golden Speedway and exact existing seams. Remove old gravel overlap and persist the trim through later ground-registration updates.
- [x] Correct skinny-triangle running contacts; pass thirteen ground groups, including six walk/run tracks with zero unsupported frames. Retain the original failures and one explicitly bounded exact-edge point-ray ambiguity.
- [x] Add physical glass and static local reflections to selected Welch/GDC windows; pass eleven shader/lifecycle checks and default/optional-AO browser rendering. Keep capture stalls and static-reflection limits explicit.
- [x] Pass TypeScript, focused lint, production build and 1,545 facade comparisons; retain prior approach, inner-route and clipping/worker regressions.
- [x] Replay GDC south wall contact/retreat/jump/return, the corrected Welch service crossing and inner walk, and a separate Tower door/stair down-up-down/continuous Speedway return in task-owned Chrome.
- [ ] Clean remaining northern Welch/lecture-wing and surrounding scan distortions; improve close materials, foliage, startup/streaming and sustained performance. The first twenty entries remain an architectural first pass.

Evidence: `evidence/iteration-54/README.md`; regional inventory: `../research/campus20/BUILDING-PASS.md`. Exact photo-supported versus inferred forms, failed attempts and final source hashes are retained.

### Iteration 53 — Welch south wing, roof and supported approaches

- [x] Calibrate three facades and a complete south-cap roof against UT footprint, photographed proportions and live height samples; record survey uncertainty.
- [x] Replace fragmented Speedway forecourt with graded planting, an inner walk and exact gray-border join; keep golden Speedway consistent.
- [x] Connect west and south entries to verified Mall paving, including seven west steps; retain floor support inside all east arcade recesses.
- [x] Pass TypeScript, focused lint, production build, 1,376 facade comparisons, twelve Welch approach groups, existing ground/controller checks and clipping/worker regressions.
- [x] Play all three Welch entrances, west stairs, ordinary window recess, retreat, jump/landing and Speedway return in task-owned Chrome.
- [x] Replay Tower closed-door contact, broad terrace and narrow stairs down/up/down, then return continuously through East Mall to GDC; finish grounded, keys released, zero imagery/browser console errors.
- [ ] Replace remaining northern Welch/lecture-wing distortions, refine glass/stone and surrounding terrain; establish sustained desktop performance. Full-campus realism remains incomplete.

Evidence: `evidence/iteration-53/README.md`. Initial failed grade/load and development-reload attempts are explicitly separated from the successful replay.

### Iteration 52 — safe cut boundaries and Welch reference audit

- [x] Audit 3,721 scene cuts and reproduce two malformed plane sets deleting synthetic witness geometry 185–188 m outside their intended bounds.
- [x] Enforce the bounding box during clipping; preserve texture interpolation and the original failure evidence. Reject five collinear west-24th cut footprints.
- [x] Verify unchanged west-24th visible/physical buffers, materials and entrances; pass clipping, worker, facade, ground/controller, TypeScript, focused lint and build checks.
- [x] Replay Tower doorway walking/running contact, retreat, jump/landing, stairs in both directions and the continuous return through East Mall to GDC; separately inspect west 24th.
- [x] Have three regional agents investigate Welch, the full cut inventory and GDC; preserve genuine rooftop geometry and stage a photo-informed Welch fallback.
- [ ] Resolve remaining East Mall fragments. The bounded-cut fix does not remove them; Welch fallback roof heights and doorstep joins still need calibration before integration. Campus realism remains unfinished.

Evidence: `evidence/iteration-52/README.md`; reference and independent diagnosis: `../research/east-mall-fragments/BOUNDARY-REVIEW.md` and `../research/welch-south-reference/README.md`.

### Iteration 51 — east-pavilion limestone and glazing

- [x] Compare actual east-pavilion photos with the current game and add restrained limestone grain, filtered relief and roughness variation without extra joint patterns.
- [x] Replace uniform teal glazing with muted dielectric glazing and camera-dependent room-depth cues; retain the upper blinds.
- [x] Review one generic CC0 limestone material; install only its original color map and sample a joint-free inset. Preserve source/capture-method uncertainty and credits.
- [x] Prove unchanged facade geometry, entrance, clearance volumes and ten material batches; pass 1,282 authored facade rays, TypeScript, focused lint and build.
- [x] Replay doorway walking/running contact, retreat, jump/landing, narrow stairs in both directions and continuous return through East Mall/Speedway to GDC in isolated Chrome.
- [ ] Improve real surrounding reflections, cavity shading, rough scan foliage, floating remnants and incomplete neighboring facades. This is a local material improvement, not final campus realism.

Evidence: `evidence/iteration-51/README.md`; material references and provenance: `../research/main-east-material-review/README.md`.

### Iteration 50 — east entrance, paving and continuous doorway support

- [x] Rebuild Main Building's east entrance from reference photos, remove overlapping frame/masonry surfaces, and retain the streamed upper Tower.
- [x] Calibrate East Mall aggregate and limestone while preserving Speedway, West Mall and the accepted player.
- [x] Reproduce a doorway-approach fall; add a measured graded apron and trim its intersecting grass skirt. Keep visible and physical geometry consistent.
- [x] Pass 123 floor comparisons, six walk/run approach-return tracks and a lateral crossing without streamed support; preserve the initial failing results.
- [x] In a separate headless Chrome, walk/run into the closed door, retreat, jump/land, and continuously return down the Tower stairs through East Mall and Speedway to GDC. Final keys are released and browser/imagery errors are empty.
- [x] Pass TypeScript, focused lint, build, 1,282 above-ground facade rays and 513 existing ground comparisons.
- [ ] Improve flat stone/glass, residual scan fragments, foliage boundaries and green terrain skirts. Headless performance samples do not resolve desktop streaming stalls or memory retention.

Evidence: `evidence/iteration-50/README.md`. Final browser testing used a separate task-owned Chrome after the desktop became locked; earlier desktop attempts are retained separately.

### Iteration 49 — exact-geometry startup optimization and Tower replay

- [x] Reduce isolated scene construction from 14.44 s to 5.56 s while preserving the complete authored geometry/cut hash.
- [x] Play continuously from MLK through Speedway and East Mall to the Tower, then return to GDC. Exercise running, jumping, narrow stairs in both directions, railing contact and retreat.
- [x] Pass TypeScript, focused lint, build, 513 ground comparisons and 1,260 above-ground facade rays.
- [x] Replace the blurred Main Building east entrance and calibrate the pale terrace materials against reference photos — initial pass in iteration50.
- [ ] Resolve development-session memory retention and remaining streaming frame spikes; no stable frame-rate claim.

Evidence: `evidence/iteration-49/README.md`.

### Iteration 48 — first twenty-location architectural pass

- [x] Integrate seventeen regional building improvements from three parallel agents, alongside the three root-led locations in iteration 47.
- [x] Replace generic shells with photo-informed recesses, entrances, roof profiles and region-specific details. Keep character and Speedway material unchanged.
- [x] Preserve the appropriate existing yards, eliminate duplicate authored shells, and match registered collider geometry.
- [x] Adapt Waggener west/Garrison north entrances to their actual retained yard heights; validate 1,260 above-ground facade rays and existing Inner Campus controller routes.
- [x] Inspect regional walking views and play sampled approach/retreat/jump scenarios. Record failures and obscured views separately.
- [ ] Complete remaining scan-boundary cleanup, correct low windows obscured by sloping soil, refine reflections/material variation and improve cold loading/streaming stalls. Full-campus realism remains unfinished.

Evidence: `evidence/iteration-48/README.md`. Building list and region ownership: `../research/campus20/BUILDING-PASS.md`.

### Iteration 47 — Union, Hogg and Flawn foreground

- [x] Install separate Hogg and Union exteriors and tune FAC stone piers. Repair the FAC foreground gap.
- [x] Correct Union south datum using low-origin live ground observations and add a bounded graded entrance join.
- [x] Verify authored render/collision agreement, route fixtures, live Hogg/Union wall approach and retreat, and FAC foreground appearance.
- [ ] Refine coarse Hogg/Union exterior ground and pale close-range materials. These are not photorealistic final assets.

Evidence: `evidence/iteration-47/README.md`. The twenty-building pass is tracked separately in `../research/campus20/BUILDING-PASS.md`; staged agent assets are not counted as live verification.

### Iteration 46 — regional agents, building detail and the Inner Campus connection

- [x] Resume live work after manual unlock. The prior browser-access block is resolved; the full-campus goal remains active and incomplete.
- [x] Integrate three photograph-informed regional packages: Gearing/Painter/Welch north/BIO on west 24th; FAC's pierced screens and colonnade; GDC brick, glazing depth and terrace materials. Keep the accepted player unchanged.
- [x] Fit and integrate the 243.66 m Inner Campus connection using low-origin live observations and exact existing-ground joins. Add 13 simple trees.
- [x] Pass 513 rendered/physical ground comparisons and offline Union, West Mall and Tower-sidewalk controller routes. Playtest Tower junction → Union court → return → Tower west, and separately the correctly aligned West Mall connector out-and-back with a jump/landing.
- [x] Correct the visible/physical mismatch in Hackerman's west and rear extensions; reproduce the previously failing west-wall approach and verify that it now stops the character.
- [x] Remove the detached scan beam over Gearing with an inset upper-air cut; preserve lower ground and unrelated buildings. Verify curved window geometry and roof/courtyard appearance in the browser.
- [x] Review GDC and FAC from walking height, approach their frontages, and test GDC wall contact/jump/landing. Final browser state is grounded with keys released, collision readiness true and zero imagery errors.
- [x] Pass final TypeScript, focused lint and production build. Record repository-wide lint failures in other existing files separately.
- [ ] Improve soft Union/Hogg scans, remaining boundary fragments, realistic reflections and material variation. Complete all-campus navigation and sustained streaming/performance validation; these are not established by selective route checks.

Detailed changes, limitations, photographs, inputs, tests and source hashes: `evidence/iteration-46/README.md` and `manifest.json`. The final frame window was 13.3 ms median / 27.8 ms p95; this is not a guaranteed 60 FPS benchmark. Map staging is recorded separately from actual traversal.

### Iteration 45 — blocked pending manual Mac unlock

- [x] Recheck computer use: the Mac remains locked and automatic unlock is paused after physical input. This same condition has persisted across iterations 43, 44 and 45.
- [x] Confirm all connection-preparation artifacts are present, audited runtime source hashes are unchanged, and local server PID 62685 is still listening on 127.0.0.1:5173. The iteration 44 audit process already finished successfully; no pending audit process is being restarted.
- [ ] After manual unlock, resume the exact low-origin ground survey in the connection notes, fit and integrate the missing road grades, and perform the required actual-control replay. Further runtime changes remain unverified until browser access returns.

At iteration 45 the full-campus goal was blocked on browser access, not complete. That access block was resolved in iteration 46 above. The preparation history remains in `../research/inner-campus-union-reference-2026-09-06/README.md`.

### Iteration 44 — existing ground joins for the Union connection

- [x] Check 32 proposed boundary pairs against current rendered and physical geometry; all old-side samples have authored support and all new-side samples lack it. Preserve these boundaries to avoid overlapping floors.
- [x] Confirm authored ground along all 33 centerline samples of the 15.79 m West Mall transition. Identify eight unsupported lateral samples, all inside the candidate repair area.
- [x] Record exact old-side heights and a maximum rendered/physical disagreement of 0.00000347 m across 123 comparable samples. Keep real-world elevation and live traversal unverified.
- [ ] Complete the live survey and browser replay after manual Mac unlock. The lock persisted; local server PID 62685 was still listening. Runtime geometry remains at iteration 42.

Boundary evidence and integration constraints: `../research/inner-campus-union-reference-2026-09-06/README.md` and `current-authored-seam-audit.json` in that packet.

### Iteration 43 — Inner Campus Circle / Union preparation

- [x] Inspect six street references and identify four existing mapped ways connecting Tower north, Flawn, West Mall and the Union service court: 243.66 m total including the branch.
- [x] Audit current authored ground: 6 of 56 centerline queries have authored support. Streamed terrain was not loaded, so missing authored support is not a claim of a game hole.
- [x] Prepare 1,075 valid two-dimensional ground cells outside protected building footprints and existing repairs; stage 300 unmeasured browser survey positions, including branch endpoints.
- [ ] Measure actual ground and old/new seams after manual Mac unlock. Computer use reported a locked Mac with automatic unlock paused; the live game remains at iteration 42.
- [ ] Integrate measured grades, run collision checks, and complete the actual Tower → Union → West Mall replay with screenshots and performance evidence. No iteration 43 runtime change or browser acceptance is claimed.

Preparation and exact resume route: `../research/inner-campus-union-reference-2026-09-06/README.md`.

### Iteration 42 — west 24th building exteriors

- [x] Replace Welch's north wing and Painter, Gearing and Biological Laboratories using UT footprints and inspected street photographs; add recessed divided windows, masonry courses, cornices and selected tiled roofs.
- [x] Remove detached NHB frontage foliage and connect bounded planting gaps; preserve unrelated building footprints and the golden Speedway crossing.
- [x] Catch/fix ground overlap in the running simulation and a thin surviving scan obstruction in the live Welch approach; replay wall contact and retreat successfully.
- [x] Pass building wall comparisons, road/both-sidewalk controller loops, Hackerman regressions, TypeScript, lint and build.
- [x] Play west 24th → Tower wall → Speedway without relocation; separately verify East Mall stair ascent/descent, MLK return and overview recovery.
- [ ] Refine estimated architecture, Gearing arches/roof, materials, vegetation and remaining source fragments. Complete full-campus connectivity and sustained performance acceptance.

Details: `../research/WEST24_BUILDINGS_IMPLEMENTATION.md`; evidence: `evidence/iteration-42-verification.json`.

### Iteration 41 — west 24th and the left turn toward the Tower

- [x] Measure the loaded street with low-origin ground rays and record three real scan obstructions before replacing them.
- [x] Recover the three missing shared-street map segments, preserving MLK and prior incremental data.
- [x] Complete the roughly 327 m road connection: gray asphalt, pale sidewalks, a graded Speedway crossing, and 20 additional simple trees. Add about 246 m of authored treatment beyond the old short approach.
- [x] Pass six corridor groups, including 675 visible/physical floor samples and road/both-sidewalk controller round trips with actual tree wood colliders. Keep the protected UT building footprints outside the new clearance region.
- [x] Pass Hackerman forecourt and central-mall regressions, TypeScript, focused lint and the production build.
- [x] Finish an uninterrupted live Speedway → Tower north → Speedway road loop with actual controls, camera turns and a jump/landing. Separately verify both sidewalks, Tower wall contact/retreat, East Mall stair ascent/descent, overview, MLK north-side return and JGB wall contact/retreat.
- [ ] Improve residual facade/foliage scan fragments, material detail and ground transitions outside this corridor. The full-campus visual target and complete landmark-network acceptance remain open.

Details: `../research/WEST24_IMPLEMENTATION.md`; final evidence: `evidence/iteration-41-verification.json`.

### Iteration 40 — map travel and faster running

- [x] Click either map to travel; M expands the map, arrows/Enter select, Escape cancels.
- [x] Validate visible/physical landing support and capsule clearance before moving; preserve the departure body while the destination loads.
- [x] Raise Shift running from 5.8 to 8 m/s and test walls, jump/landing, map cancellation and multiple destinations in the browser.
- [x] Pass eight offline groups, responsive map review, TypeScript, focused lint and build.

Details: `../research/MAP_TRAVEL_IMPLEMENTATION.md`.

### Iteration 39 — smooth East Mall exteriors

- [x] Add eight simple closed building exteriors and increase MLK trees from 14 to 26.
- [x] Verify ground topology, matching visible/physical walls and the MLK tree-controller routes.
- [x] Resume after unlock; iteration 41 verifies the final MLK north sidewalk return, JGB wall contact/retreat, and lower East Mall stair ascent/descent.
- [ ] Complete a single final-revision upper Tower terrace ↔ MLK loop and photographic acceptance. Earlier partial upper-terrace evidence and later lower-stair checks are separate.

Details: `../research/SMOOTH_MALL_IMPLEMENTATION.md`.

### Iteration 38 — MLK and eastern East Mall

- [x] Use the five supplied street-level references and official MLK marker to add the missing eastern mall, memorial and west-facing arrival.
- [x] Add concrete walks, gravel/lawn islands, simple trees, lamps and benches; connect to golden Speedway and the existing Tower approach.
- [x] Preserve the open-road calibration anchor independently of the shaded new arrival; verify the same scan alignment on fresh load.
- [x] Walk to the memorial, climb the circular base, contact the pedestal and retreat in the live game.
- [x] Reproduce the live north-walk tree snag using actual GLB wood colliders; move/narrow trees and pass seven groups including four lateral traversals, round trip and memorial circle.
- [x] Pass the existing Tower stair/lower-riser regression, TypeScript, focused lint and final build.
- [ ] After Mac unlock, fresh-load the final tree correction, inspect its appearance and replay MLK → Speedway → Tower → MLK with jump, overview and resize checks. Browser evidence currently precedes the correction.
- [ ] Replace residual scan foliage beside JGB/WCP with measured, bounded facade work; improve materials and complete photographic acceptance.

Details: `../research/MLK_IMPLEMENTATION.md`; final geometry report `evidence/iteration-38-final-mlk-mall-check.json`.

Follow-up reference preparation: `../research/mlk-east-mall-reference-2026-09-06/NEXT_PASS.md`. Separate WCP/RLP map identities and seven candidate material maps are staged; no runtime integration or new browser acceptance is claimed.

### Iteration 37 — local depth shading and MBB corner path

- [x] Add local GTAO shading using shared scene depth, with no second campus geometry pass, 75% effect resolution and a fade before distant scenery.
- [x] Catch and correct a global tone-mapping regression on photographed imagery; retain direct/off/on same-camera evidence.
- [x] Catch a delegated asphalt shader-hook compile error in the graphics console. Make the transformation idempotent and pass three shader-hook regression checks.
- [x] Walk into and diagnose MBB's projecting north bay; widen the paved apron around it and remove conflicting inner planting. Eleven MBB groups pass, including five capsule round trips and visible corner paving.
- [x] Pass final TypeScript, focused lint and production build.
- [x] Complete the fresh 68-hold `shader-fixed-*` loop and inspect four final direct/off/on comparisons.
- [ ] Resolve repeated automation stalls during control/performance checks. They also occurred with direct rendering, so AO causation is unproven. AO remains opt-in; repeated resize/overview and clean AO cost measurement are pending.
- [ ] Replace distorted scanned surroundings and improve glass reflections, materials and architecture. Contact shading does not establish the full realism goal.

See `../research/AMBIENT_OCCLUSION.md` and iteration 37 in `evidence/PLAYTEST.md`.

### Iteration 36 — Moffett frontage north of Hackerman

- [x] Identify MBB from the official UT outline and March 2025 Speedway photos; replace approximately 48 m of its near frontage and southern return with recessed windows, pale masonry and a gray plinth.
- [x] Replace the floating near-garden scan with continuous graded ground, a building-edge walk, three shared simple trees, low planting and globe lamps. Retain the accepted player and golden Speedway.
- [x] Measure and reconstruct the glazed NHB–MBB connector, with a clear playable lane beneath it.
- [x] Pass nine MBB groups, seven Hackerman groups, eleven engineering groups and the 482-sample landscape regression. Record the exact-edge ray precision limit explicitly and verify that seam with a finite sphere and normal capsule.
- [x] Remove the last measured NHB canopy remnant and fresh-load the final revision. Complete 63 bounded movement holds through the service lane, under the bridge, across the seam, to the engineering stairs and back to Hackerman. Jump/landing, stair ascent/descent and all walking endpoints pass with zero browser/tile/worker errors. Save final appearance and local performance evidence.
- [ ] Reconstruct the farther MBB facade/arched entrance and opposite Patterson scenery; refine materials, reflections and planting. Full-campus visual and navigation acceptance remains open.

See `../research/MBB_IMPLEMENTATION.md` and iteration 36 in `evidence/PLAYTEST.md`.

### Iteration 35 — 24th bridge, San Jacinto and DKR exterior connection

- [x] Replace default-width streets with City 2023 road, bridge, sidewalk and broad stadium-apron footprints; add a 566 m route from the engineering exit to DKR west frontage.
- [x] Fit ground elevations to loaded source measurements and keep a thin elevated deck over Waller Creek, with open metal railings and matching collision.
- [x] Close crossing/classification gaps, merge connected road centerlines before buffering, remove duplicate polygon edges, and make fourteen sub-millimetre cells planar to avoid artificial steep normals.
- [x] Keep the accepted player and golden Speedway paving; unify adjoining 24th asphalt and add pale concrete/yellow stadium curb treatment.
- [x] Catch an actual stadium-wall removal bug in the browser. Compare original and repaired imagery from one camera, measure real wall intersections, and preserve a 3 m buffer around City Structure 655373 without changing the 827 physical floor cells.
- [x] Pass eleven DKR groups including the ordinary-controller round trip, 20 measured source-wall witnesses, 464 City wall witnesses, 923 clearance cells, bridge seams, railing contact and preserved space below the deck. Production build, TypeScript and focused lint pass.
- [x] Fresh-load and reach DKR through actual game inputs; test the bridge rail, both crossings, stadium-wall contact/retreat and jump/landing. The pre-facade and final-facade evidence remain separate.
- [x] Finish and record the final streamed return to engineering and Hackerman: 118 final-revision input holds have grounded endpoints, with zero imagery/worker/browser errors; the final DKR jump lands normally.
- [ ] Replace distorted scanned foliage and improve lower facades, incomplete street/island surfaces, stadium entrance detail, off-route collision and fall recovery. The new route does not establish pedestrian realism or full-campus acceptance.

See `../research/DKR_ROUTE.md`, `../research/DKR_IMPLEMENTATION.md`, `scripts/check-dkr-corridor.mjs` and iteration 35 in `evidence/PLAYTEST.md`.

### Iteration 34 — engineering pedestrian connection

- [x] Reproduce the missing-ground fall east of Speedway and add 292 m of mapped concrete walks to the EER terrace, below the GLT bridge and back to 24th.
- [x] Add two stair flights with 16 inferred risers, a central landing, a full-width top landing and handrails. Keep the accepted player and golden Speedway unchanged.
- [x] Fix angled landing gaps and terrace overlap on the first tread; share final floor geometry with collision.
- [x] Pass eleven focused groups: 621 path samples, 1,683 stair/landing samples, four ordinary-controller round trips, four measured headroom fragments removed, 11 bridge and nine Patterson source-preservation witnesses. The existing 482-sample landscape regression, TypeScript, focused lint and production build pass.
- [x] Fresh-load and replay the engineering chain, stair ascent/descent on both sides, a jump/landing and exit onto source ground with zero tile/worker/browser errors. `landing-*` captures the lateral checks; `headroom-*` is the final out-and-back revision.
- [x] Test the stadium continuation: original-source ground is walkable at X197–198, then malformed geometry blocks the approach near X199.44. Preserve the failure separately from engineering completion.
- [x] Fresh-load and repeat the complete out-and-back loop after the headroom correction, including the source transition and the previously blocked return ascent. `headroom-*` inputs identify this final revision; earlier `landing-*` evidence is historical.
- [ ] Reconstruct malformed engineering planting and lower facades, verify the San Jacinto/DKR continuation and add in-game recovery from an unexpected fall. Navigation repairs do not establish full visual acceptance.

See `../research/ENGINEERING_ROUTE.md`, `scripts/check-engineering-paths.mjs` and iteration 34 in `evidence/PLAYTEST.md`.

### Iteration 33 — Hackerman junction and simple planting

- [x] Remove four measured canopy remnants by extending the mapped 24th approach 83 m west and connecting the forecourt to it; retain the golden paving and accepted player.
- [x] Add two low planting islands with shared simple trees and shrubs behind the three existing benches.
- [x] Reproduce the 1.57 m western street/forecourt drop; grade the apron between the rising street and the building threshold.
- [x] Pass seven focused checks: 171 paving samples, four ground transects, three capsule round trips, measured fragment removal and bounded Welch/NHB source preservation. Existing 482-sample landscape regression, TypeScript, focused lint and production compilation pass.
- [x] Fresh-load and replay the graded western approach/forecourt in both directions, return through Speedway to GDC, jump/land and finish at Hackerman with zero browser/tile/worker errors.
- [ ] Resolve farther scanned foliage/façades and full-campus navigation/realism. A separate eastern-junction fixture discrepancy is retained in diagnostic evidence; the new-extension tests do not hide it.

See iteration33 in `evidence/PLAYTEST.md` and `scripts/check-hackerman-approach.mjs`.

### Iteration 32 — corrected GDC ground walls, sculpture and atrium

- [x] Separate UT feature402 ground walls from the City roof outline; rebuild both stepped west ends and use the design architect's stack-bond brick specification.
- [x] Add Circle with Towers at published overall dimensions, a five-band stepped atrium, and clear paths around the sculpture.
- [x] Use actual rear-view feedback to replace a tall flat bed with a graded gravel edge; match lamp bases to the same ground.
- [x] Find the removed-source gap beyond the inner wall and narrow its cut; remove measured atrium/roof overlaps and floating scan inside the reconstructed open court.
- [x] Pass the full 482-sample landscape regression and the focused facade/atrium geometry checks; final courtyard checks pass 14 groups and the atrium cleanup passes seven groups.
- [x] Fresh-load and replay the final courtyard loop, sculpture/door contact and retreat, WCP jump/landing, and return to Hackerman with zero browser/tile/worker errors.
- [ ] Improve plain glazing, retained far-roof remnants and surrounding scan defects (including Hackerman foliage); full-campus/GTA-level acceptance remains open.

See iteration32 in `evidence/PLAYTEST.md` and `../research/scenery-reference-2026-09-06/surroundings/GDC_IMPLEMENTATION.md`. Earlier iteration31 courtyard and brick descriptions are superseded.

### Iteration 31 — GDC west wings and courtyard approach correction

- [x] Rebuild both six-storey west ends and four corner returns from the photo review; register the roof/base with live source probes and use a bounded 12 m replacement.
- [x] Add continuous sloping frontage, pale paths and four low hedge runs; retain simple shared trees and the accepted player.
- [x] Reproduce the mapped courtyard path crossing a new wall, then correct both near-building path corners with capsule-width clearance.
- [x] Pass 600 wall rays, 254 path samples, isolated capsule traversal and bounded source-preservation checks; pass the full 482-sample landscape regression, TypeScript, focused lint and production compilation.
- [x] Fresh-load and play spawn → GDC north approach/wall → courtyard loop → south approach/wall → WCP jump/landing → GDC → Hackerman, with zero browser/tile/worker errors.
- [x] Exclude the reflection-capture experiment after measured first-frame stalls; retain the existing sky environment. No experimental capture code remains in the runtime.
- [ ] Reconstruct the recessed GDC court/atrium and remaining neighboring scan defects; refine approximate stepped corners, materials and full-campus traversal. This is not final realism acceptance.

See iteration 31 in `evidence/PLAYTEST.md` and `../research/scenery-reference-2026-09-06/surroundings/GDC_IMPLEMENTATION.md`.

### Iteration 30 — consistent Speedway and the Hackerman boat corner

- [x] Follow the user's simplified scope: accepted player, simple trees, golden paving and recognizable landmarks. Stop Sketchfab acquisition.
- [x] Extend the same paving through the nine connected Speedway ways, 787 m including the 24th approach; add a coplanar dark drainage strip.
- [x] Recreate NHB using its actual UT polygon, blue glazed corner, pale deep openings, brick massing and open roof screen. Keep the merged City footprint out of the replacement.
- [x] Recreate 70 open canoes and the separate pedestal/truss; integrate into the live game at the published location.
- [x] Add a graded pale forecourt, timber benches and a closed terrain edge. Inspect source overlap and remove the old malformed sculpture in the bounded authored area.
- [x] Pass 482 centerline/ground/physics samples, TypeScript, focused lint and the final production build; retain the strict 1 mm visual/physical ground agreement after making the drain flush.
- [x] Replay ordinary spawn → Hackerman forecourt → northern Speedway → GDC → WCP → Hackerman, plus a jump and landing, with zero tile/worker/browser errors.
- [x] Use actual game input for pedestal contact/running push/retreat and building-envelope approach/slide/retreat. See iteration 30 in `evidence/PLAYTEST.md` for the final route record.
- [ ] Improve untouched neighboring scanned façades/foliage and the simple glass appearance. This is a recognizable authored approximation; full-campus visual/navigation acceptance remains open.

Sources and scope: `../research/SPEEDWAY_SCENERY.md`. The source photographs informed geometry; they are not flat panels used as the building.

### Iteration 29 — foreground becomes the default

- [x] Make the authored foreground the normal homepage and preserve raw scan at `?walkway=scan`.
- [x] Replace the invented 13.5 mSpeedway width with the provisional PWP 30 ft / 9.144 m width; document conflicting supplier 36 ft description.
- [x] Introduce inventory-informed GDC positions and broader scenery shadows; retain generic shared crowns. Iteration30 caps their size per the simplified direction.
- [x] Replay spawn→GDC→WCP and jump/land with the accepted player; replay spawn→GDC after the final shadow change with zero tile/worker errors.
- [x] Pass geometry/physics checks, TypeScript, focused lint and production compilation.

### Iteration 27 — preserve the Tower facade

- [x] Trace missing walls to a 1.15–1.24 m map/scan footprint mismatch, using same-camera cached-source comparisons and source-ray locations.
- [x] Apply a shared 2 m building protection margin to East/West Mall clearance. Keep the authored paving/stair profiles and controller settings.
- [x] Preserve eight measured facade locations through the real clipper while retaining useful path clearance. Pass all seven flights, the corrected Tower/Union route, pier and garden-curb fixtures.
- [x] Walk/run spawn → GDC/East Mall → Tower → Union and return, with a jump/landing and mouse camera turns. Correct the old diagonal shortcut to go around the preserved Tower corner.
- [x] Verify all eight wall rays against the cached original in the final live scene: zero measured difference. Repeat tall-pier contact/retreat; record zero tile failures or uncaught browser errors during the fresh replay.
- [x] Pass TypeScript, focused lint and production build. Detailed browser evidence is in `evidence/PLAYTEST.md`.
- [ ] Replace residual scanned canopy fragments, improve pedestrian materials/vegetation and validate other landmark boundaries; this fix does not establish whole-campus realism.

Details: `../research/CAMPUS_SCAN_PROTECTION.md`; evidence uses `iteration-27-*`.

### Iteration 26 — West Mall and Texas Union

- [x] Reconstruct mapped West Mall paving, its two garden islands, Tower west steps, Guadalupe gateway steps and the Union frontage sidewalk.
- [x] Preserve the unresolved circular feature and gateway masonry; eliminate 9.397 m² of source paving/building overlap from the clearance footprint.
- [x] Remove overlapping Tower ground beneath the new flight and give its treads usable depth. Keep the existing controller step/slope settings.
- [x] Pass seven-flight ascent/descent at three lateral positions, Tower-to-Union walking/running in both directions, low-bed curb entry/exit, tall-pier blocking/retreat and bounded scan-clearance checks.
- [x] Pass TypeScript, focused lint, production build and the existing landscape regression. Inspect the real meshes in an isolated WebGL fixture.
- [x] Complete spawn → Tower → West Mall → Union frontage and return with actual game input. Verify one jump/landing, camera turns, and tall-pier running contact/retreat. One initial 429 recovered; no additional errors during the replay.
- [x] Compare cached original and repaired geometry at an identical camera position, restoring geometry/visibility immediately.
- [x] Fix the sampled Tower facade loss in iteration 27 with measured map/scan clearance. Other landmark boundaries still need validation; zero overlap with mapped footprints alone is insufficient.
- [ ] Refine provisional grades, stair dimensions, mature-oak forms, paving, seams and close architecture against the photographs. The isolated fixture does not establish realism.
- [ ] Complete DKR and remaining campus branches, then full-scene visual and sustained-streaming acceptance.

Details: `../research/WEST_MALL.md`; evidence uses `iteration-26-*`.

### Iteration 25 — East Mall and Tower connection

- [x] Integrate the recovered East Mall and Tower paving into the landscape preview: 32 areas, 21 lower graded risers and five mapped stair flights.
- [x] Keep the intermediate wall/rail as obstacles and route through its side stairs; add the sphere landing, garden edging and seven lamps.
- [x] Clip paving/clearance away from mapped buildings; verify zero final clearance overlap across 1,279 footprints. The added repair covers 7,642.5 m² with 264 volumes.
- [x] Reproduce the first-riser grounding failure with actual game gravity; retain walkable lower-capsule support without increasing the 32 cm step or 45° climb limits.
- [x] Close grade-dependent riser cracks and boundary gaps; widen the final Tower landing to the full stair width.
- [x] Walk/run from normal spawn through GDC and Speedway to the Tower south terrace without teleporting or jumping over stairs. Return via the north-side flight and descend to Speedway.
- [x] Verify central-wall running contact and retreat. Check all five flights up/down at three lateral positions, all 21 lower risers, PCL stairs, walls, jumping, low ceilings and walking off a ledge.
- [x] Replay both PCL stair flights in both directions and one airborne jump/landing with the new support helper.
- [x] Diagnose 194 HTTP 429 responses during the long replay; add an independent download queue, visible cooldown, bounded backoff and disposal/permanent-error checks. Observe real pause/resumption in the fresh browser.
- [x] Correct the mall's green/blotchy material response and inspect the actual meshes under game lighting in an isolated WebGL fixture.
- [x] Fresh-load the final material/download-recovery revision and walk/run from spawn through GDC/East Mall to the Tower terrace at (-215.10, 19.43, 53.85), grounded with zero jumps. No uncaught browser exceptions were recorded.
- [ ] Resolve sustained tile availability: the final replay accumulated eight natural HTTP 429 failures plus one injected failure and exhausted three retry waves. The controlled failed tile was not observed retrying successfully.
- [ ] Replace residual scanned canopy fragments and improve trees, planting, stair proportions, materials and close Tower architecture. Deep skirts and inferred riser spacing remain provisional.
- [ ] Validate West Mall/Union, DKR, remaining branches and sustained streaming/rate-limit recovery. The complete game and realism target remain unfinished.

Details: `../research/CENTRAL_MALLS.md`; browser input and diagnostic records use `iteration-25-*`. The default `/` still preserves the unmodified scan; this repair is in `?walkway=landscape`.

### Character refinement — human silhouette, fitted hair and deforming straps

- [x] Retain the complete anatomical head, ears and neck; replace the coarse hair cards with a scalp-fitted short haircut and 1,400 tapered fibers beneath the white Longhorn cap.
- [x] Replace overlapping shorts/calf surfaces with continuous trouser legs joined at two validated thigh contours.
- [x] Round clothing with one offline subdivision pass; preserve UV seams and consistent skeletal weights. Current asset including new hair: 98,357 triangles, 5.06 MB GLB plus 0.61 MB textures.
- [x] Fit backpack straps to the jacket and transfer torso skin weights. Across 36 sampled poses, maximum strap-center distance drops from 3.68 cm to 0.88 cm; all 1,533 unique anatomical head positions are unchanged.
- [x] Give the character viewer a close Hair view; use the same manifest-versioned GLB in the viewer and game.
- [x] Inspect final side/back/hair views and walking/running; pass 180 pose samples, knee topology/skin-weight checks, TypeScript, focused lint and the production build.
- [x] Replay northern spawn → GDC/WCP/PCL, a jump/landing, narrow and broad stairs, table contact/sliding and retreat. Fresh-load verification confirms the final hair/model revision in both game and viewer; exact-revision smoke replay covers walk/run/jump/camera.
- [x] Fresh-load revision `9675a5372d2ab020` in the viewer and campus game; inspect side/back/hair and walk/run, then replay walk/run/jump/landing and mouse orbit with normal game input.
- [ ] Further improve the haircut's close-up variation, cloth folds/materials and facial animation. This remains an approximate game character, not final photorealistic likeness.

Details: `../research/PERSONAL_CHARACTER.md`; latest evidence uses `human-pass-*` and `character-review-human-game-*`. Earlier `character-review-*` captures describe the preceding asset.

### Iteration 23 — lighting repair and Tower-route diagnosis

- [x] Reproduce a black-material rendering defect on SwiftShader and fix non-finite sky-environment values; verify finite lighting on Metal and preserve the visible sun.
- [x] Recover East/West Mall pedestrian multipolygons with holes and validate source hash, 32 order/reversal cases, three rejected invalid inputs and 1,279 building comparisons.
- [x] Derive horizontal route candidates and collect 90 closer height rays, with 52 hits.
- [x] Reproduce the blocked westward East Mall approach, confirm it with a second running push and retreat safely.
- [x] Integrate and reconstruct the East Mall foreground/stair sequence and complete the Tower connection in iteration 25.
- [ ] Complete West Mall/Union traversal. The iteration-23 graph alone does not establish a walkable route.

Details: `../research/CENTRAL_MALLS.md` and the iteration-23 evidence files.

### Historical iteration 22 — PCL seating plaza and stair repair

- [x] Compare the plaza with atlas L118/L115/L105; combine mapped paving, terraces and stair outlines with low source-ground samples.
- [x] Replace the bounded 3,326.61 m² plaza foreground with dark paving, an upper terrace, two stair flights, railings, 10 picnic tables, five globe/banner lamps, six tree placements and three hedge runs. The horizontal plaza footprint overlaps none of the 1,279 mapped buildings.
- [x] Add the north blank wall above the terrace. Current façade total: four faces, 186 bays, 14,724 triangles in six batches.
- [x] Give paving, stairs, retaining edges and furniture matching visible/collision geometry. Keep foliage out of walkable-ground queries; retain separate trunk/hedge collisions.
- [x] Replay engineering → GDC → WCP → PCL from normal spawn, ascend the east steps, descend/ascend the broad steps, push into a picnic bench, retreat, and jump back toward Speedway.
- [x] Reproduce a broad-stair edge snag that the center-only check missed; fit the tread heights across the sloping approach and replay the same side successfully in both directions.
- [x] Check 43 plaza surfaces, four stair ascent/descent lines, 20 façade cases and 402 landscape route samples; pass TypeScript, focused oxlint and the production build.
- [x] Save the final local performance sample and explicitly retain failed/misaligned attempts in the playtest record.
- [ ] Improve approximate tree forms, planting placement and concrete/glass/wood response. Remove residual scan strips and canopy masses outside the rebuilt plaza.
- [ ] Reconstruct lower entrances and remaining façades; finish full-campus movement, sustained-streaming and visual acceptance. **This remains a local opt-in milestone, not the completed game.**

Environment geometry details: `../research/PCL_PLAZA.md`; subsequent lighting/data and character work is recorded above. The latest browser evidence is at the top of `evidence/PLAYTEST.md`. Earlier iteration sections below describe historical states and counts.

### Historical iteration 21 — authored PCL exterior faces

- [x] Compare PCL against atlas L105/L107/L115/L118 and inspect the official upper-floor plan before authoring geometry.
- [x] Add northeast and southeast window bays plus the long blank east wall, with recessed angled glazing, concrete piers and sloping heads. Current total: three faces, 186 bays, 14,688 triangles, six mesh batches.
- [x] Give the façade and sloping ground apron matching rendered/physical geometry; lighten and rescale the parapet masonry.
- [x] Correct flat bays that hid the glazing at oblique angles and reduce over-bright/ribbed material appearance.
- [x] Replay engineering → GDC → WCP → PCL, stairs in both directions, parapet contact/retreat, blank-wall contact, two jump landings and the eastern apron exit after the final clearance edit.
- [x] Pass 14 façade render/collision checks, preserved synthetic roof/ground fixtures, the 402-sample landscape regression, TypeScript, focused oxlint and the production build. Six new horizontal clearance footprints overlap only PCL.
- [x] Reinspect the unchanged complete human from the back/side and in walk/run animations. The hair and anatomical profile remain visible.
- [ ] Remove residual floating scan fragments and large canopy masses. The southeast view still fails after streaming settles; the new clearance band is only a partial correction.
- [ ] Refine the inferred dimensions and uniform concrete/glass appearance; build the actual PCL plaza, landscaping and lower entrance details. **The preview remains opt-in and does not pass final realism acceptance.**
- [ ] Refine the character's sleeve/knee topology and backpack strap fit during locomotion. Facial expression and blinking remain absent.

Reference provenance and assumptions: `../research/pcl-facade/README.md`. Final browser captures and test results are in iteration 21 of `evidence/PLAYTEST.md`.

### Iteration 20 — background preparation and Speedway through PCL

- [x] Move scan clipping to two background workers; copy only the dispatched geometry, transfer results, and reject stale results after tile disposal.
- [x] Keep old collision meshes until all required replacements are prepared. Exercise cancellation, worker failure, disposal, buffer ownership and collision retention in a focused regression check.
- [x] Extend the experimental route to 678 m: all eight connected mapped Speedway pedestrian ways, plus the eastern 24th Street approach.
- [x] Remove a replacement tree from the turning route and cut intersecting grass strips out of the paving. The preview now has 31 trees; 25 proposed placements were excluded near mapped paths.
- [x] Replay 24th Street → GDC → WCP → PCL, including a jump/landing and the southern boundary in both directions, through the game's actual input controls.
- [x] Walk up and down the mapped PCL stair opening near local (-50, 333).
- [x] Reproduce the PCL scan's passable parapet/drop; replace its bounded northeast edge with a visible 54 m brick retaining parapet and matching collision. Replay running contact, sliding and retreat without falling.
- [x] Check 402 route centerline samples, 42 parapet render/collision samples and 21 synthetic running wall approaches; verify upper-façade geometry above the repair is preserved.
- [x] Compare PCL against expanded references L115/L118 and capture a similar westward view near L118. **The visual comparison fails the final realism target.**
- [x] Run TypeScript, focused lint and the final production build. Current delivery remains local.
- [ ] Refine the parapet's approximate registration and generic masonry, and test its ends, jumping over it, and lower-level access. A successful running approach does not validate all PCL collisions.
- [ ] Replace the generic grass bands/trees around PCL with its actual paved seating plaza, hedges, globe lamps, railings and planting layout. Rebuild warped façade bays and shaded lower-level geometry from the reference atlas.
- [ ] Resolve remaining side-boundary snags, white gaps and malformed canopy fragments; replay Tower, Union, engineering and DKR in the streamed world. **The landscape preview remains opt-in.**

The expanded atlas is `../research/streetview-reference-survey/expanded/`. Its photos guide the actual scene; successful tile loading does not establish a recognizable pedestrian view. See iteration 20 in `evidence/PLAYTEST.md` for the failure/fix evidence and measured performance.

### Iteration 19 — foreground landscape and connected approach

- [x] Add an opt-in `?walkway=landscape` preview covering 287 m: the 179 m Speedway section plus its eastern 24th Street approach.
- [x] Add 22 textured broadleaf trees with shared materials and three geometry LODs; collide against woody trunks rather than solid leaf canopies.
- [x] Remove the scanned canopy obstruction from this route and close the thin scan sliver at a mapped path joint using overlapping clearance volumes.
- [x] Give authored pavement its own ground-query collection; retain source-only calibration and exclude decorative foliage from landing queries.
- [x] Add sampled ground transitions and skirts; close the large white boundary gap in the inspected northern view.
- [x] Replay the repaired approach, GDC corridor and WCP exit with running and a jump/landing; approach and retreat from a replacement tree trunk.
- [x] Check all 1,279 building polygons against the 80 actual removal-volume footprints: no area overlap. Check 172 centerline samples, joint clearance, upward ground, canopy exclusion and matching transition collision.
- [ ] Complete side-boundary walking: a run crossed the tested western edge, but a subsequent walking approach approximately one metre away still snagged. Ground registration remains approximate.
- [ ] Resolve remaining white gaps at other points, cut canopy fragments, malformed façades, southern scan obstructions and camera interference. **This preview remains opt-in.**
- [ ] Replace the repeated generic tree arrangement and grass embankments with location-specific landscaping, beds, lights, benches and entrance details from the reference survey.
- [x] Move scan clipping off the rendering thread — completed in iteration 20. Iteration 19 recorded a 25.4 ms maximum synchronous mesh preparation job.

See `../research/FOREGROUND_ENVIRONMENT.md` and iteration 19 in the playtest record for assets, actual tests and remaining defects.

### Iteration 14 — Speedway collision-repair experiment

- [x] Add an opt-in `?walkway=pilot` experiment for the 179 m mapped Speedway stretch beside GDC (OSM way 126307538).
- [x] Check that its 13.5 m wide footprint has no area overlap with the current campus building polygons.
- [x] Use exactly the same trimmed triangle geometry for display and Rapier collision; preserve interpolated UVs and untouched geometry.
- [x] Validate clipping area, overlapping volumes, boundary vertices, local/world transforms, complete removal, UV continuity and Rapier ground/wall preservation with a focused executable check.
- [x] Run from the 24th Street spawn to Speedway, run the pilot from north to south, jump/land, and cross the southern boundary using actual game input.
- [ ] Resolve canopy fragments and visible side gaps before promoting this experiment. **The pilot is intentionally not the default view.**
- [x] Move expensive clipping preparation off the rendering thread — completed in iteration 20. Iteration 14 measured a 34.3 ms synchronous preparation job.

The new paving uses a generic CC0 herringbone material, informed by the GDC reference photograph. It is not a scan of Speedway. The source contour terrain is an approximation and still needs better registration along walkway edges.

See `evidence/PLAYTEST.md` for dated runs and `../research/CESIUM_INTEGRATION.md` for architecture, source limitations and remaining work. Diagnostics are read-only: `window.__campus.snapshot()` and `surfaceAt(x,z)` do not provide teleportation or collision bypasses.

Browser playtests use native clicks, key taps and mouse drags, plus timed DOM KeyboardEvents delivered to the game's normal input listeners. The browser adapter cannot hold raw-CDP keys. Physics and animation execute normally; no position setters are used during testing.

The current local test viewport is 1280 × 720 CSS pixels at renderer pixel ratio 1.5. Short 600-frame street samples measured around 8.3 ms median / 8.7–8.8 ms p95 frame intervals, with roughly 2–3 ms CPU submission and 2 ms GPU render times. These are measurements on this computer, not a cross-device or sustained-performance guarantee. Earlier procedural runs showed longer-session variability.

## Preserved procedural work

`?visual=procedural` retains the full 1,279-building GIS layout, 4,159 path segments, contour terrain, 74 generated stair segments, photo-informed landmark approximations and revised vegetation. Iterations 01–11 in the playtest record refer to that fallback. Their passed routes and visual placeholders should not be confused with the new streamed environment.
