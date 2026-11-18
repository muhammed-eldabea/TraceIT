# Extension architecture

## Purpose and scope

The extension reads configured text files in a VS Code workspace, extracts artifacts and references with regular expressions, resolves directional trace links, and displays or exports the analysis. Each workspace folder is an independent project configured by its root `traceability.json`. The original documents remain the source of truth; the analysis is rebuilt in memory on refresh.

## Components

```text
VS Code workspace                      VS Code extension host
┌───────────────────────────┐          ┌──────────────────────────────┐
│ traceability.json         │─────────▶│ Extension / TraceProvider    │
│ configured text files     │─────────▶│ discover and read files      │
└───────────────────────────┘          └──────────────┬───────────────┘
                                                      │ config + text
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Engine: validate, extract,   │
                                       │ resolve links, coverage      │
                                       └──────────────┬───────────────┘
                                                      │ analysis result
                                   ┌──────────────────┼───────────────────┐
                                   ▼                  ▼                   ▼
                            Sidebar tree       Dashboard webview     HTML report
                            VS Code items      src/dashboard.js      engine.report()
```

- **`package.json`** registers the activity bar container, tree view, commands, and `reqtrace.exclude` setting.
- **`src/extension.js`** is the VS Code integration layer. `TraceProvider` loads each folder's configuration, discovers matching files via `workspace.findFiles`, reads text, invokes the engine, and constructs the sidebar. It owns the current in-memory results, dashboard lifecycle, navigation, and report save dialog.
- **`src/engine.js`** is independent of the VS Code API. It validates and compiles patterns, extracts artifacts and references, resolves links, computes coverage, and renders the standalone HTML report.
- **`src/dashboard.js`** renders the in-editor dashboard from the same analysis results. Webview messages request refresh, report generation, or navigation; the extension host validates navigation indexes before opening an artifact.
- **`examples/sample/`** provides a small configured project, including one intentionally unresolved reference.
- **`tests/engine.test.js`** exercises engine behavior with Node's built-in assertions.

## Processing flow

1. Activation registers the tree provider and commands, then refreshes open workspace folders. Refreshes also occur when the dashboard or report is opened or requested; file changes do not automatically refresh analysis.
2. For each folder, the extension reads `traceability.json` and validates source names, link rule endpoints, and regex syntax. Each source has a `name`, `include` glob, `artifact` regex, and optional `reference` regex.
3. The extension finds files per source, applies `reqtrace.exclude`, and skips files over 1 MB and files containing a zero byte. Each source/file pair is processed separately, so overlapping source globs intentionally analyze a file more than once.
4. The engine scans lines in order. An artifact regex captures `id` and optionally `title`. A reference regex captures `target` and belongs to the most recent artifact in that file. Each expression is applied at most once per line.
5. Artifacts are indexed by source and ID. A reference is resolved through rules whose `from` matches its source and whose `to` contains the target ID. Exactly one candidate creates a link; zero or multiple candidates create an unresolved reference. Duplicate IDs within a source produce a diagnostic.
6. For each rule, coverage counts target artifacts with at least one incoming link from the configured source and type, divided by all target artifacts in that source. A link is a textual match, not proof of implementation or verification.
7. The result contains `artifacts`, `links`, `unresolved`, `diagnostics`, and `coverage`. The tree, dashboard, and report consume it. The report is saved as an independent HTML file.

## UI and commands

- **Requirements: Open Traceability Dashboard** opens a themed editor panel with coverage, artifact links, locations, and diagnostics. Select an artifact ID to open its file.
- **Requirements: Refresh Traceability** rescans all open workspace folders.
- **Requirements: Generate Traceability Report** rescans, prompts for a folder in multi-root workspaces, and saves HTML.
- The sidebar lists artifacts and their incoming and outgoing neighbors. It supports navigation to source files.

## Current limitations

- Text, initial DOCX, XLSX and ReqIF imports, and experimental Codebeamer and DOORS Next adapters are available; PDF, DOORS Classic and other commercial-tool connectors remain outstanding.
- Regex matching is line-based and captures one artifact and one reference per line. Project analysis and regex testing use worker threads with time limits; document extraction and other extension-host work remain separate.
- Analysis is manual-refresh, synchronous inside the engine, and held in memory. No persistent graph, background indexing, change history, baselines, suspicious-link workflow, or explicit link editor exists.
- Read errors and invalid project configurations are shown as errors; skipped binary and oversized files are not currently listed as diagnostics. A read failure can prevent that folder's analysis.
- Dashboard and report reflect extracted links, not verification status or safety-standard qualification.
- The previous `requirements.json` prototype format is not supported by this configuration model.

## Verification

Run `node tests/engine.test.js`. Launch an Extension Development Host with F5 and open `examples/sample` to exercise the VS Code integration, dashboard, navigation, and report export. Automated tests do not currently run the VS Code host or webview.

## Document inspection and format roadmap

`src/regexTester.js` tests a JavaScript regular expression against each line of the active VS Code text buffer, displays matches and named groups in an output channel, and navigates to a selected match. The native text editor remains responsible for editing and saving. Unsaved buffer changes are visible to the tester, while project analysis reads saved files. See [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md) for the interface inventory and adapter gaps.

## Impact analysis

The dashboard can analyze potential impact for each artifact. `engine.impact` walks incoming links breadth-first, because an artifact that references or covers the changed target may be affected. It follows indirect links, records the first discovered path and depth, and visits each artifact once to terminate on cycles. This is a potential-impact aid, not an assessment of whether a change actually affects the downstream artifact.

## Initial ReqIF import and baselines

`src/reqif.js` imports a subset of ReqIF XML objects and relations; ReqIFz extraction is also supported. ReqIF export and write-back are not implemented. `src/baseline.js` saves analysis snapshots and compares artifact content and links, highlighting unchanged links whose endpoints changed.

## Codebeamer adapter

`src/codebeamer.js` fetches the documented Swagger v2 cbQL item endpoint using paginated read-only requests. Project configuration supplies a connection name and query; VS Code secret storage holds the base URL and credentials. Imported items are added to the analysis using their Codebeamer numeric IDs and navigated through an HTTPS browser URL. The adapter rejects redirects, incomplete pagination and changing totals. Optional REST v1 association import resolves item links across sources sharing a connection; unsupported or incomplete response structures fail the scan. Experimental v3 item-name and description write-back are available through `src/codebeamerWrite.js`; real-server compatibility is unverified.

## Word extraction

`src/docx.js` extracts text from DOCX bytes using Mammoth. A `docx` source applies the normal line-based regex rules to that text. Artifact navigation uses the `reqtrace-docx` read-only virtual document provider to display the same extracted text; it does not edit the Word file or preserve page coordinates.

## DOORS Next OSLC adapter

`src/oslc.js` accepts an explicitly configured query URL, requests RDF/XML, follows same-origin OSLC pagination and loads query members. It maps Dublin Core titles and identifiers and OSLC RM relations to in-memory artifacts and links. Credentials are stored in VS Code secret storage bound to a configured origin. The experimental adapter includes a restricted title update; actual DOORS Next discovery, authentication negotiation, configuration management semantics and live interoperability are unverified. DOORS Classic requires a separate adapter.

## VS Code host smoke test

`tests/integration/index.js` runs in an Extension Development Host and checks extension activation, command registration, overlapping refresh calls, dashboard command execution, and DOCX virtual-document extraction and navigation. It was run with VS Code 1.146.0 on macOS; this does not verify dashboard rendering, export dialogs, remote connectors, or other VS Code versions. The host test requires VS Code to be launched with `--extensionDevelopmentPath`, `--extensionTestsPath`, and an isolated user-data and extensions directory.

## Manual links

The add/remove commands store explicit source/ID/type records in the workspace's `traceability-links.json`. `src/manualLinks.js` validates the file; the engine resolves each endpoint against unique artifact identities and merges it with discovered links. The extension checks whether the stored file changed since its last scan before writing; this is an optimistic check, not an atomic collaborative lock.

## Excel extraction

`src/xlsx.js` loads XLSX workbooks read-only and converts nonempty rows into tab-separated sheet name, original row number, and cell values. The regex engine analyzes the extracted text; `reqtrace-xlsx` provides its read-only virtual view. Cached formula values are used without recalculation, with diagnostics for missing cached values.

## PDF extraction

`src/pdf.js` uses PDF.js to reconstruct page text, records page numbers and reports pages with no extractable text. The `reqtrace-pdf` virtual document displays extracted text. A separate read-only PDF.js webview renders original pages and supports page navigation and zoom; it does not edit the original PDF. The extractor does not perform OCR and page reading order is not guaranteed for complex layouts.

## CSV imports

`src/csv.js` parses column-mapped CSV exports, including quoted multiline fields. It stores artifact IDs, titles, text, optional reference IDs, and optional configured string attributes, with the starting line of each record for VS Code navigation. CSV records are added to the normal link-resolution and coverage pipeline; attributes are displayed and included in baseline comparisons. This is file import, not a live DOORS Classic adapter.

## Source coverage graph

`src/graph.js` renders configured source-level coverage rules and artifact counts as an SVG, with an accessible textual rule list. It uses `result.coverage`, so the displayed direction and counts match the dashboard summary. The graph is limited to 50 sources and 50 rules; the underlying analysis is not truncated.

## Project configuration commands

`src/projectSetup.js` provides commands to create a project, add sources, and add coverage rules through VS Code prompts. It validates the configuration using the analysis engine, strips compiled regular-expression caches before serializing, and uses workspace edits so configuration changes participate in VS Code's document editing workflow. Project creation does not overwrite an existing configuration.

## Artifact table interaction

The dashboard filters the already analyzed artifacts in the webview by text, source, and link presence; it can sort by artifact ID and expand escaped extracted text. Filtering changes the displayed rows only and does not recalculate coverage or modify the underlying analysis.

## DOORS Classic bridge prototype

`resources/doors-classic/export-current-module.dxl` is an experimental, manually run DXL export for the currently open module. `src/doorsClassic.js` checks its completion marker and record counts, rejects duplicate module/absolute-number identities and links whose source object was not exported, and preserves module path plus absolute number for link resolution across exports sharing a connection group. Rejected exports appear as analysis diagnostics. This is not a live connector and has not been validated in DOORS Classic.

The dashboard requests impact on demand from the extension host instead of precomputing a result for every artifact. The host indexes incoming links for breadth-first traversal and sends the selected result to the webview, which constructs display nodes as text. The dashboard still renders the artifact table and matrix on refresh; those views are not virtualized.

The configured-pattern tester uses the source text captured during the latest scan and can update an artifact or reference regex through a VS Code workspace edit. It verifies that the saved pattern has not changed since the scan and checks source text before navigating to a match.

## Worker isolation

`src/workerRunner.js` executes `src/analysisWorker.js` in a Node worker thread. Project analysis has a 30-second limit; regex tests have a five-second limit and a 50,000-match cap. A timeout terminates the worker and fails the operation. The worker receives document text and configuration but not VS Code URI objects; the returned graph retains shared artifact identities. DOCX, XLSX and PDF extraction runs in separate workers with a 30-second limit per document, including extracted-document views.

## PDF visual viewer

`src/pdfViewer.js` owns a restricted VS Code webview and delivers the selected PDF bytes after the client is ready. `resources/pdf-viewer.js` loads PDF.js and renders one page at a time on a canvas with navigation and zoom. Dashboard PDF artifacts retain an original URI and page number for navigation; regex testing continues to use extracted text.

## Word visual viewer

`src/wordViewer.js` displays sanitized Mammoth HTML in a script-disabled webview with a restrictive content policy. Conversion and sanitization run in the document worker. The view is read-only and is not a faithful reproduction of Word page layout or tracked changes.

## Workbook visual viewer

`src/workbookViewer.js` uses an isolated XLSX worker to build a bounded read-only model, then sends the model to `resources/workbook-viewer.js`. The webview builds its table using text nodes and pages through populated rows. The regex extraction carries sheet and original row locations into artifacts so dashboard navigation can open the corresponding row. Formula values are cached, not recalculated.

### Workbook text edits

The Excel viewer lets users select a cell and edit an existing plain-text cell and save the result as a new `.xlsx` file. It does not overwrite an existing file. Merged, protected, signed, macro-enabled, formula, numeric, rich-text, hyperlink and empty cells are unsupported. The original source is checked for changes before saving. Dependent formula values are not recalculated; open the copy in a spreadsheet application and recalculate before using those results. Saving currently requires a local filesystem destination.

The DOORS Next adapter retrieves each OSLC query member separately to collect its available details and relationships. The account must have permission to read those resources; an inaccessible member fails the import instead of producing partial results. Large queries can take longer because each member requires a request. Actual server compatibility still requires live validation.

Codebeamer association requests include `inout=true` so links pointing to queried items are discovered as well as outgoing links. The adapter retains link direction and deduplicates repeated associations. Links whose other endpoint is outside the imported results are reported as unresolved. This behavior is based on the [PTC association API documentation](https://support.ptc.com/help/codebeamer/r3.1/en/codebeamer/developers_guide/Associations.html) and still requires validation against the target installation.

Codebeamer sources support `"apiVersion": "v2"` or `"v3"` for cbQL item queries. Omitted `apiVersion` preserves the existing v2 behavior; newly added sources prompt for the version. The v3 query uses `/api/v3/items/query`; association import can use REST v1 or Swagger v3. Select a version supported by the actual server and validate both APIs with its permissions. See [PTC v3 query documentation](https://support.ptc.com/help/codebeamer/r2.2/en/codebeamer/developers_guide/dg_tracker_items_based_on_cbql_query.html).

For Codebeamer associations, set `"includeAssociations": true` and optionally `"associationApi": "v3"` (the default is `v1`), or choose the option when adding a source. V3 reads each item’s incoming and outgoing association IDs and fetches each unique association to obtain its endpoints and type. Only tracker-item source endpoints and tracker-item or URL targets are supported; other association shapes fail the import. This path has mocked tests and needs live-server validation. PTC describes the [v3 relations endpoint](https://support.ptc.com/help/codebeamer/r3.2/en/codebeamer/developers_guide/swagger/dg_inserting_html_code_into_wikitext_field.html).

When a Codebeamer v3 relations response reports additional pages, the adapter stops rather than importing partial associations. Tracker references are distinct from associations and are not yet imported; their presence is reported as a diagnostic so coverage is not mistaken for complete.

The Word viewer offers **Edit text run in copy**. It lets you select and replace one complete XML text run and saves a new local `.docx` without overwriting an existing file. Word may split a sentence across runs, so not every visible selection can be edited this way. Tracked changes, protected, signed, and macro-enabled documents are unsupported. This does not provide general Word editing.

Reference patterns are applied repeatedly to each line, so one line can link to multiple targets. Repeated occurrences of the same target on the same line produce one reference; empty target captures produce diagnostics. Patterns remain line-based.

ReqIFz extraction runs in a size-limited worker and supplies the XML to the existing ReqIF parser. The virtual `reqtrace-reqifz` document provider re-extracts the archive for source navigation; attachments remain unprocessed.

ReqIF imports resolve enumeration labels and declared relationship type names when definitions are present. Missing enumeration or relationship type definitions produce diagnostics; full ReqIF datatype support remains incomplete.

ReqIF relationship scalar, enumeration and XHTML attributes are retained on links and displayed in the dashboard and report; supported type defaults apply when an explicit value is absent. XHTML is converted to ordered plain text, without formatting or embedded-media fidelity. Baselines compare captured link attributes; links with repeated source, target and type identities are excluded from comparison with a warning, and older snapshots warn when link attributes were not captured.

ReqIF object-type defaults for scalar, enumeration and XHTML attributes are applied when the object has no explicit value for that definition. An explicit empty value suppresses the default. XHTML is converted to ordered plain text, with the same fidelity limitations as explicit XHTML values; live interoperability and complete datatype support remain unverified.

If multiple populated ReqIF attributes on an object share a display name, the first retains the name and later values receive definition-ID suffixes. A diagnostic flags the ambiguity; configured attribute mappings using the unsuffixed name select the first value.

ReqIF specification hierarchies are retained as artifact placements, including multiple specifications, and displayed in the dashboard and HTML report. Hierarchy placement is not treated as a trace link or included in coverage.

New baselines include imported artifact attributes and specification placements when checking for changes and suspicious links. Older baselines remain readable, but comparisons warn that metadata was not compared; save a new baseline to include it.

Baselines also capture connector-native artifact identities. A changed identity for the same source and displayed ID marks the artifact as changed and its retained links as suspicious. Older snapshots remain readable and comparisons warn that native identities were not compared.

Baseline previews and exported comparisons show expandable before-and-after values for changed artifact fields and captured link attributes. Values are HTML-escaped; comparisons still warn when older snapshots lack the data required for a field.

Dashboard matrix link creation and removal send stable project and artifact identities to the host. The host validates the configured rule, refreshes and validates again, then persists the manual link using the existing manual-link file workflow. The matrix action does not write back to remote sources.

ReqIF XHTML text extraction preserves inline reading order and basic paragraph breaks. The extracted view is plain text; formatting, images, tables, and attachments are not faithfully reproduced.

Imported artifact attributes are visible in the dashboard and HTML traceability report. Structured connector values are displayed as escaped JSON text.

Repeated references between the same source artifact and target with the same type are represented as one link; their citation line numbers remain available in the dashboard and HTML report.

Remote relationship resolution indexes external identities by source format and connection group. This preserves ambiguity checks and isolates identical IDs from separate connections while avoiding a full artifact scan for each relationship.

Sources may declare a `group` and projects may define directional `groupLinks`. During analysis, each group rule expands to source pairs for reference matching, with duplicate source rules removed. Group coverage counts distinct linked target artifacts across all sources in the destination group. The dashboard renders groups as folder nodes, allows connecting nodes by drag or keyboard selection, and exports the diagram as standalone SVG. Group coverage and the diagram also appear in the HTML report. This grouping does not move or modify source documents.

PowerPoint `.pptx` sources support read-only slide text extraction with presentation-order slide locations. A text-only slide viewer supports navigation; faithful visual slide rendering, speaker notes, images, charts, OCR, and general PowerPoint editing are not supported. The text-only viewer can replace a selected text run in a new local copy; signed, protected, and macro-enabled presentations are rejected.

The DOORS Next source wizard accepts an optional HTTPS configuration context URL. It is sent on query and resource requests, and remote link resolution is scoped to that context. Sources configured with different contexts are not implicitly joined. Live validation against the target server is still required.

The OSLC importer follows same-origin pagination for both query results and individual requirement responses, retaining each requirement's original URI across detail pages. A failed or cyclic detail-page sequence fails the import rather than silently returning partial properties. This behavior is covered by simulated responses and requires live-server validation.

DOORS Next RDF XML-literal titles and descriptions are converted to ordered plain text with basic paragraph breaks. Formatting and embedded media are not preserved; plain RDF string literals remain unchanged.

Codebeamer field discovery uses authenticated read-only v3 tracker-field list and definition endpoints. The command resolves the selected item's connection from secret storage; credentials are not included in the displayed JSON. Field schemas and remote write behavior remain subject to target-server validation.

The experimental Codebeamer name and description update commands use a field-specific v3 update and a temporary soft lock. It rechecks the imported version, current name, tracker, and field definition under the lock, then attempts unlock. Failures and uncertain outcomes are surfaced without automatic retry. Same-account concurrent operations can still remove a lock; these workflows require live validation and do not provide general field write-back. Description updates additionally compare the current text and format and use a reviewed multi-line draft.

DOORS Next import prioritizes the Jazz RM `primaryText` property over `dcterms:description` and retains a separate description attribute when both are present. XML-literal markup is converted to readable plain text; the original RDF representation is separately fetched for restricted write-back.

The experimental DOORS Next title update fetches the original RDF representation and a strong ETag, changes a single unambiguous plain title while retaining other XML content, and sends the representation with `If-Match`. It rejects paged resources and unsupported XML shapes. This implementation is tested with mocks, not a live server; it is not general RDF write-back.

A separate experimental DOORS Next operation selects one text segment inside RDF XML-literal `primaryText`, preserves the surrounding XML, and submits the full resource with its ETag. Unsupported structures are rejected and there is no live-server validation.

`npm run test:connector-https` runs simulated DOORS Next and Codebeamer write flows over a local HTTPS server using a temporary test certificate. It requires OpenSSL. The certificate is trusted only by the test client; these tests do not replace live-server validation.
