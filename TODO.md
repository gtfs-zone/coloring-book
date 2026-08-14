Needs research (mine, not in the plan yet)
- Bug: if I delete all stop times, the stop should be removed. Something leaves ""

In the plan (see PLAN_TODO.md)
- Bug: "Is Default Fare Category" / "Fare Media Type" click does nothing (possibly more)
- Bug: multiselect-with-search escape should close only that modal, not the one
  beneath (ie fares modal)
- Bug: after selecting shapes for all trips in a route, it doesn't remove the
  straight line route. I had to refresh the page for it to disappear. (this
  seems to be a race, because the next time it worked)
- Bug: loading a feed pops the Files modal open, it shouldn't
- Feat: unify dangling reference handling. Present them as issues, make them
  findable and fixable, without silently making them work. Covers the nuuk
  x3_... dangling shape and the nuuk route 1 bad agency_id.
- Feat: change navbar shapes icon to match open in brouter
- Feat: instead of "New shape from GPX" lets have an upload button. After
  upload, lets default to the filename in the input and allow changes before
  locking in the id
- Feat: in nav bar show number of each item (# services, # shapes, # fare
  products, # changes) We can show it as a little notification style bubble.
- Feat: clicking stop markers in timetables should focus that stop. Hovering
  should highlight the stop in some way. Lets share the highlighting with
  ../test-track as well (they already have click on name)
- Feat: show the route diagram including all trips on the route page, just like
  we do in the realtime (../test-track), sharing code as much as possible
- Feat(large): Instead of any places where we list services, lets try using the
  timeline view. We could do that for the feed page (all services) and anywhere
  else we list services (route page, etc) it would be filtered and contain the
  appropriate links. We might just drop the count of trips etc because that's
  not particularly useful
- Feat: remove glyph "emojis" like ▶ ◀ ▲ ▼ → and replace them with proper SVG
  icons, in theme, sharing the icon helpers as much as possible
- Feat: improve the shapes list. Include the routes using each shape, linking to
  those routes, and the number of trips using the shape. Make the table
  scrollable with the header still visible and the upload GPX button always
  visible. No horizontal scrolling, use a wider modal if needed.
- Bug: tooltips are not working in the fares tables, they should be back
- Feat: finish unifying tooltips. The services timeline and calendar modal now
  use the portaled field-tooltip-trigger, but timetable-renderer.ts still uses
  native title attributes (dangling reference cells, brouter/delete buttons,
  stop rows). Sweep the rest of src/ for title= and DaisyUI tooltip/data-tip.
  Done: the portal now sits at z-[2000], above DaisyUI's modal layer, so
  tooltips inside modals show up
- Bug: the Files modal is not scrollable
- Bug: going back to the Files modal's file list still shows the last file that
  was clicked; that prior-selection behavior should be fully stripped
- Bug: opening a small file in the Files modal shrinks the modal; it should
  stay the same size regardless of file content
- Feat: synchronize the better looking stop styles (focus halo/ring, focus-top
  redraw, hover halo) to ../test-track, sharing the styling code instead of
  keeping two divergent copies
- Feat(medium): Lets add support for the tables in fares to have lists
  (reducing repetitive columns). For now, lets do this for fare_products with
  fare_media_id. In fare_leg_rules, lets do it for from_area_id and to_area_id.
  In fare_transfer_rules, lets do it for from_leg_group_id and to_leg_group_id.
  In fare_leg_join_rules, we can do it for both OD pairs. Lets list the items
  in the table for now to make it super clear (newlines between). Lets use the
  opportunity to use the same display method for areas and networks tables
  (internal logic will remain different for these two)
