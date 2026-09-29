/* ==========================================================================
   AMAYA ERP - Brand assets (module 00, loaded first)
   ----------------------------------------------------------------------------
   The wordmark is inlined as a data URI rather than shipped as a separate file.
   One reason is the offline promise: a Capacitor WebView with a file:// base
   URL, and a single-file web bundle, both resolve relative image paths
   differently or not at all, and a broken logo on a printed invoice is far
   more visible than a few kilobytes of base64.

   It lives in its own module, listed first in build.ps1, so the asset can be
   replaced without touching the 50 KB core file.

   COLOUR NOTE - read before swapping this file for a new wordmark:
   the logo is drawn for light backgrounds. Anywhere it sits on a dark surface
   (the sidebar, the login aside) it is shown on a white plate via .brand-chip
   rather than composited directly, so legibility never depends on guessing
   what colours the artwork uses. If you replace it with a mark designed for
   dark, drop the plate class and the logo will fill its box.
   ========================================================================= */
'use strict';

/* The wordmark's base64, split into 96-character chunks and concatenated. A
 * single literal this long is unreadable in a diff and very easy for an editor
 * to re-wrap into something that will not parse. */
const BRAND_LOGO_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAzYAAABkCAMAAABjP1USAAAFFmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0' +
  'IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpu' +
  'czptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0MzUyLCAyMDIwLzAxLzMwLTE1OjUwOjM4' +
  'ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1u' +
  'cyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEu' +
  'MC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8v' +
  'bnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21t' +
  'LyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNy' +
  'ZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMSAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDIzLTAxLTEyVDIx' +
  'OjA3OjMyKzA2OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyMy0wMS0xMlQyMTowNzo1MSswNjowMCIgeG1wOk1ldGFkYXRhRGF0' +
  'ZT0iMjAyMy0wMS0xMlQyMTowNzo1MSswNjowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9' +
  'IjMiIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIuMSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDph' +
  'MmE3MTI4ZC04MTY1LTFkNGMtYTc2Mi00MDU4MWQyMjg3MzUiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6YTJhNzEyOGQt' +
  'ODE2NS0xZDRjLWE3NjItNDA1ODFkMjI4NzM1IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6YTJhNzEyOGQt' +
  'ODE2NS0xZDRjLWE3NjItNDA1ODFkMjI4NzM1Ij4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFj' +
  'dGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDphMmE3MTI4ZC04MTY1LTFkNGMtYTc2Mi00MDU4MWQy' +
  'Mjg3MzUiIHN0RXZ0OndoZW49IjIwMjMtMDEtMTJUMjE6MDc6MzIrMDY6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2Jl' +
  'IFBob3Rvc2hvcCAyMS4xIChXaW5kb3dzKSIvPiA8L3JkZjpTZXE+IDwveG1wTU06SGlzdG9yeT4gPC9yZGY6RGVzY3JpcHRp' +
  'b24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz5qjT6CAAAACXBIWXMAAC4jAAAuIwF4pT92' +
  'AAADAFBMVEVHcEz////////////////////gHib/////////////////////////////////////////////////////////' +
  '///////////////////gHib/////////////////////////////////////////////////////////////////////////' +
  '///////////////////////////////////////////////////gHibgHib////////////////////////////gHib////g' +
  'Hib////////////////////////gHib////////gHibgHib////gHib////////////////////////////gHibgHibgHib/' +
  '///////////////gHib////////////////////////////////////////////gHib////////////////////////gHibg' +
  'HibgHib////////////////////////////gHib////gHib////////gHibgHibgHib////gHib////gHib////gHib/////' +
  '///////gHibgHib////////gHibgHib////gHib////////////////////gHibgHib////////gHibgHibgHibgHibgHibg' +
  'Hib////////gHib////////////gHib////gHib////////gHibgHibgHib////////gHibgHibgHibgHibgHibgHibgHibg' +
  'HibgHib////gHibgHib////gHib////////gHib////////gHib////gHibgHib////gHibgHibgHibgHibgHibgHibgHibg' +
  'HibgHibgHibgHib////gHibgHib////////gHib////gHibgHib////gHibgHibgHibgHibgHibgHibgHib////gHibgHibg' +
  'Hib////gHibgHibgHibgHibgHib////gHibgHibgHibgHib////gHib////gHib////gHib///+z8Qw8AAAA/nRSTlMAvJZ2' +
  'S9eH21qH0LT+peoNCAS38HjO7uL69Jb3xQ8qAUDSu8DgzAIVGAX8xOQKH2H7rRzZPjzWvrPovNcHLaCcp5l0+7m/e00hvzNt' +
  'Vqve4bTU1SXxZ45yTBY/NroTQmpcA5Rd5igahuVVL+vCCYue3BJjg8KuGMpSj0hrsWUrOsXIT/6ZJjbNhNxWSMYQfg4UHrBC' +
  '30UeosdYNSMGAewLn/gjxu/R83/zYPaqb4otmDmBFasybw08lRtm47JFhIKmXkSPo1DmJ1dON+vKnzLpx5yMzyGJl0/xMG13' +
  'knn2JBEoiBCidLeze2OAOFtKdVJq7SCRR3EvyQzaEyl+l447FqQAABgaSURBVHja7F15eBRVEh9ElF0mZJJIDiOBcAQSAUmA' +
  'AJKEIwIREZA7IIQ7sAICAsawC3IoZ2AJx4fAEsAlQORQVg5RlmMBFWFRPtEFXFhcdF3BT/2WD/Fjv67Nzcx0ve4386p62o+t' +
  'P2e6q9+rql+/6qp69RwOdTp0yXGvUu77AXjoyOWO/9Mvn6Zpw+09wMSRXJy/HGX9bLLBxcT52U/vOdsNbRmoJ0/Ypp23tWjy' +
  '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';

const BRAND = {
  /** Data URI for the 822x100 transparent PNG wordmark. */
  logo: 'data:image/png;base64,' + BRAND_LOGO_B64,

  /** Intrinsic aspect ratio (w/h). Used to reserve layout space so the header
   *  does not reflow once the image decodes. */
  aspect: 822 / 100,

  /** Initials shown in the compact square mark when no wordmark fits. */
  monogram: 'A',

  /** Full legal name. Printed on documents. */
  legalName: 'AMAYA Industries',

  /** Short product name. Used in titles, app labels and footers. */
  shortName: 'AMAYA ERP',
  /** Injects the wordmark into any element with `data-brand-slot` (login, sidebar). */
  paint() {
    if (typeof document === 'undefined') return;
    $$('[data-brand-slot]').forEach(el => {
      el.innerHTML = `<span class="brand-chip" role="img" aria-label="${esc(BRAND.legalName)}">`
        + `<img src="${BRAND.logo}" alt=""></span>`;
    });
  }
};

/** Render the logo into placeholder slots. Called once at boot, and again on
 *  every render because the login and sidebar slots are re-created by login
 *  screen and nav rendering respectively. */
function paintBrand() { BRAND.paint && BRAND.paint(); }