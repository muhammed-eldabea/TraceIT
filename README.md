# Requirements Traceability

A VS Code extension prototype for extracting artifacts and directional trace links from text files with configurable regular expressions. It generates a standalone HTML traceability report.

## Try the example

1. Open this extension folder in VS Code and press **F5**.
2. In the Extension Development Host, open `examples/sample` as the workspace folder.
3. Open the **Requirements** activity bar and run **Requirements: Open Traceability Dashboard**. Select an artifact ID to open its source. Use **Requirements: Refresh Traceability** after editing files.
4. Run **Requirements: Generate Traceability Report** from the Command Palette and choose where to save the HTML file.

## Configure a project

Place a `traceability.json` at the root of each workspace folder. See `examples/sample/traceability.json`. Each source has a name, a VS Code glob in `include`, and an `artifact` regular expression with a named `id` group and optional `title` group. An optional `reference` expression must have a named `target` group. Patterns are JavaScript regular expressions encoded as JSON strings and are applied once per line. A reference belongs to the most recently parsed artifact in the same file, including a reference on its declaration line. Each link rule defines a `from` source, a `to` source and an optional `type`. IDs must be unique within a source; ambiguous and unresolved references are reported, not linked.

The report lists artifacts, their incoming and outgoing links, and parsing diagnostics. A link is evidence of a configured textual reference, not proof of implementation or test success. Files above 1 MB, binary files, and paths matching `reqtrace.exclude` are skipped. Plain text, read-only Word, Excel and PDF text extraction, and initial read-only ReqIF XML import are supported. Project analysis, binary document extraction, and regex tests run in worker threads with time limits; a timeout stops the analysis instead of producing a partial report. Use trusted configurations and avoid expressions with excessive backtracking. The earlier `requirements.json` prototype format is replaced by `traceability.json`.

Run the engine checks with `node tests/engine.test.js`.

See `ARCHITECTURE.md` for the component design and processing flow.

Open a text document and run **Requirements: Test Regex in Active Document** to inspect matching lines and named groups, then select a result to navigate and edit in VS Code. Save changes and refresh analysis. See `FORMAT_SUPPORT.md` for the interface inventory and current support.

In the dashboard, select **Analyze impact** on an artifact to see potentially affected artifacts reachable through incoming links, including indirect dependencies.

## ReqIF import and baselines

Configure a source as `{ "name": "exchange", "include": "*.reqif", "format": "reqif" }` to import ReqIF objects and relations. This initial importer supports uncompressed XML ReqIF and basic values; it is not a live connector and does not provide full ReqIF round-trip fidelity. ReqIF files are limited to 20 MB.

Run **Requirements: Save Baseline** to save a snapshot, and **Requirements: Compare Baseline** to produce an HTML change report including potentially suspicious links. Compare snapshots of the same project; duplicate source/ID pairs are excluded.

ReqIF sources may set `idAttribute`, `titleAttribute`, and `textAttribute` to attribute **long names** in the exchange file. The importer uses the selected ID for links from other configured sources while retaining the ReqIF internal identifier to resolve imported relations. For example:

```json
{ "name": "doors-export", "include": "exports/*.reqif", "format": "reqif", "idAttribute": "Identifier", "titleAttribute": "Title", "textAttribute": "Description" }
```

Missing configured attributes are reported in the dashboard and HTML report. Inspect the exported ReqIF's attribute definitions to choose names; they vary by source project and export configuration.

## Codebeamer connection (experimental)

Run **Requirements: Configure Codebeamer Connection**, enter a connection name, HTTPS server base URL including its context path (for example `https://example.org/cb`), and credentials. VS Code stores the credentials in its secret storage; they are not written into `traceability.json`. Password authentication uses HTTP Basic; bearer tokens require server support. Add a source:

```json
{ "name": "codebeamer", "format": "codebeamer", "connection": "my-server", "query": "project.id IN (2) AND tracker.id IN (2284)" }
```

The source runs the [Codebeamer Swagger v2 item query](https://support.ptc.com/help/codebeamer/r3.0/en/codebeamer/developers_guide/swagger/dg_query_tracker_item_with_cbql.html) and imports item IDs, names and descriptions. Local sources can reference item IDs via normal link rules. Selecting an imported item opens its Codebeamer URL. Query pagination errors stop the project analysis rather than silently reporting partial coverage. This adapter has mock-based tests only; it has not been tested against a live server. Set `"includeAssociations": true` on a Codebeamer source to opt in to incoming and outgoing association retrieval. The adapter expects documented string `from`, `to`, and `type` fields, reports associations outside imported results, and resolves links across sources sharing the same connection. Association response shapes have only been checked against mocks and require live-server verification. Experimental v3 item-name and description updates are available as described below. Other field updates, OAuth negotiation, and custom certificate handling are not implemented. Server authentication and supported API versions vary by installation.

## Word text extraction

Configure a source with `"format": "docx"`, a `*.docx` include glob, and the same artifact and reference regular expressions used for text files. The extension extracts text from DOCX files up to 20 MB and opens a read-only extracted-text view when an artifact is selected. Line numbers refer to the extracted text, not Word page numbers. Edit and save the original document in a Word-compatible editor, then refresh. Formatting, page layout, tracked changes, comments, and lossless write-back are not supported.

## DOORS Next OSLC query (experimental)

Run **Requirements: Configure DOORS Next Connection** to save a connection name, HTTPS server origin, and Basic credentials or a bearer token in VS Code secret storage. Provide an OSLC query URL obtained from your server's service provider or administrator:

```json
{ "name": "doors", "format": "doors-next", "connection": "my-doors", "queryUrl": "https://doors.example.com/rm/your-oslc-query-url" }
```

An optional `configurationContext` source property sends an OSLC `Configuration-Context` header. The adapter requests RDF/XML, follows `oslc:nextPage`, imports query members and OSLC RM relations between imported members, and navigates to their resource URLs. It accepts only HTTPS requests to the origin entered when configuring the connection and does not follow HTTP redirects. It does not discover query URLs, perform OAuth/Jazz form-login negotiation, import relations to artifacts outside the query, support DOORS Classic, or generally write changes back; an experimental title update is described below. The adapter is based on OSLC RM and has only been tested with mocked responses, not with a DOORS Next server; server-specific configuration and behavior may require changes.

## Manual trace links

Run **Requirements: Add Manual Trace Link** to select a configured link rule, a covering artifact, and a covered artifact. Run **Requirements: Remove Manual Trace Link** to remove a manually recorded link. Links are saved in `traceability-links.json` in the workspace root; include this file in version control with `traceability.json`. Missing or duplicate endpoint IDs produce diagnostics. Removing a manual link does not remove links independently extracted from source documents. Concurrent file changes are checked before saving, but this is not a collaborative locking system.

## Excel workbook extraction

Configure `"format": "xlsx"`, an XLSX include glob, and artifact/reference patterns. Set `"sheet"` to a worksheet name to analyze only that sheet. Each nonempty row is represented as tab-separated `sheet name`, `row number`, then cell values in column order. For example, a workbook whose first two columns contain an ID and title can use:

```json
{ "name": "excel-requirements", "format": "xlsx", "include": "requirements/*.xlsx", "sheet": "Requirements", "artifact": "^[^\\t]+\\t[0-9]+\\t(?<id>REQ-[0-9]+)\\t(?<title>[^\\t]+)" }
```

Selecting an artifact opens a read-only extracted TSV view. Its first two fields identify the worksheet and original row; its line number is the extracted-view line, not the Excel row number. Cell newlines and tabs become spaces. Formulas use cached values and missing cached results are diagnostics; the extension does not calculate formulas. Workbook formatting, editing, macros, legacy XLS, and lossless write-back are not supported. Save changes in a spreadsheet editor and refresh. Files are limited to 20 MB and sheets to 100,000 rows and 1,000 columns.

## PDF text extraction

Configure a source with `"format": "pdf"`, a PDF include glob, and artifact/reference regex patterns. The extractor emits `[Page N]` markers and reconstructed text lines; selecting an artifact opens the read-only extracted text. The dashboard and report include its PDF page number. Empty or image-only pages produce diagnostics; OCR, PDF editing, and reliable text reconstruction of complex tables or multi-column layouts are not supported. PDF files are limited to 20 MB and 2,000 pages.

## CSV and DOORS Classic exports

A CSV source maps column names to traceability fields, including quoted multiline fields. For example:

```json
{ "name": "doors-classic-export", "format": "csv", "include": "exports/*.csv", "idColumn": "Object Identifier", "titleColumn": "Object Heading", "textColumn": "Object Text", "referenceColumn": "Links", "referenceSeparator": ";", "attributeColumns": ["Status", "Owner"] }
```

Only `idColumn` is mandatory. Other column names must match the headers in the actual export; `referenceColumn` is optional and must contain target IDs separated by `referenceSeparator` (default `;`). `attributeColumns` optionally lists additional unique column names to retain as string attributes for the dashboard, report, and baseline comparison. The Create Project and Add Source wizards offer these mappings for CSV sources. Configure link rules to resolve these IDs to other sources. `delimiter` may be set to a single character, such as `"\t"`. The source file opens in VS Code at the record's starting line and can be edited there. Importing an export is not a live DOORS Classic connection and does not automatically extract DOORS links that are absent from the export.

The dashboard's **Document group coverage** graph shows configured rules from covering to covered groups. An arrow represents a rule, not proof that any artifact has been linked. Expand **Coverage rule details** for the linked-target counts.

### Document groups and coverage arrows

Sources can be collected into named document groups. Each source still chooses its own file glob, parser and patterns, so a group can contain documents from several folders and formats. In the dashboard, open **Project configuration and extraction patterns**, choose **Organize document groups**, select sources, and enter a group name. You can also edit the project configuration:

```json
{
  "sources": [
    { "name": "System requirements", "group": "Requirements", "include": "requirements/**/*.md", "artifact": "^(?<id>REQ-[0-9]+): (?<title>.+)$" },
    { "name": "Test cases", "group": "Verification", "include": "tests/**/*.md", "artifact": "^(?<id>TEST-[0-9]+): (?<title>.+)$", "reference": "^Verifies: (?<target>REQ-[0-9]+)$" }
  ],
  "links": [],
  "groupLinks": [{ "from": "Verification", "to": "Requirements", "type": "verifies" }]
}
```

In **Document group coverage**, drag from the covering folder to the covered folder, or select the two folders in order, then choose a link type. The arrow percentage is the number of distinct covered target artifacts divided by all target artifacts in the destination group. It is not a test-pass percentage. Sources without an explicit group appear as individual folders. Use **Export diagram (SVG)** to save the picture; the HTML report also includes it and lists uncovered targets for each group rule. The diagram shows at most 50 groups and 50 rules; reports and coverage totals use all analyzed artifacts.

## Configure a project in VS Code

Open **Requirements: Get Started** for the built-in walkthrough. In the Requirements tree, use the title-bar buttons to open a project folder, save edited project files, or reload the saved analysis. Projects contain source groups, artifacts, links, and any analysis issues. Reload warns when there are unsaved edits; it does not discard them.

Run **Requirements: Open Project Folder** to choose a directory or enter its absolute path. If no configuration exists, the setup flow creates `traceability.json` there before opening the folder in a new VS Code window. Alternatively, run **Requirements: Create Traceability Project** in an open workspace. Use **Requirements: Add Source** and **Requirements: Add Coverage Rule** to configure sources and their relationships.

The dashboard's **Project configuration and extraction patterns** section shows each source type, path or query, and regex. It provides setup actions and an editable JSON configuration; Save validates the file and refuses to overwrite changes made elsewhere. Unsaved webview drafts are retained across dashboard refreshes. Connector credentials are stored separately in VS Code secret storage. Remote connectors remain experimental.

In the dashboard's artifact table, search by ID, title, extracted text, or path; filter by source, link presence, a selected artifact attribute and value, or coverage for a selected rule; and select the **Artifact ID** heading to sort. With an attribute selected and its value empty, the filter shows artifacts that have that attribute. A coverage-rule filter shows the rule's target artifacts and can narrow them to covered or uncovered targets. Expand **Extracted text** to review imported content. “Has links” and rule coverage indicate detected graph links, not verified implementation or passing tests.

Use **Requirements: Edit Manual Trace Link** to change a saved manual link's endpoints or type. The dashboard's **Compare baseline** button opens a read-only comparison in VS Code; use **Requirements: Compare Baseline** when you want to save the comparison as HTML. These commands do not edit links in the source systems.

Use **Requirements: Export Traceability Matrix CSV** or the dashboard's **Export matrix** button to select a coverage rule and save its full matrix. Rows are covered artifacts, columns are covering artifacts, and `linked` indicates a resolved relationship. Source locations distinguish repeated IDs. The CSV includes analysis status, uses a UTF-8 BOM, and prefixes formula-like values with an apostrophe for safe spreadsheet import. Exports above five million matrix cells are rejected; narrow the source selection first.

The generated HTML report lists every uncovered target for each configured rule, including its source location. Its embedded matrices show up to 80 artifacts per side; the uncovered lists and coverage totals are not limited to that preview.

## DOORS Classic export bridge (experimental)

Run **Requirements: Open DOORS Classic Export Script** to inspect the supplied read-only DXL script. With a formal module open, run it in the DOORS Classic DXL Interaction window; it writes a temporary CSV file and prints the location. Copy the file into the workspace and rename it with a `.doors.csv` suffix. Export each relevant module separately. Configure a source for each module, for example:

```json
{ "name": "classic-requirements", "format": "doors-classic-export", "include": "exports/requirements.doors.csv", "connection": "my-classic-database", "linkType": "references" }
```

Use the same `connection` value for exports from the same database so outgoing links resolve across modules. Add a coverage rule with the same `linkType` where needed. The script uses `entire` and excludes deleted and unreadable objects. It captures plain heading and text and outgoing link target module/absolute-number identities; it does not capture rich formatting, attributes, baselines, external links, or link-module types. The export includes a completion marker and counts, and the importer rejects missing or inconsistent markers. It reports unreadable objects counted by the script. Text encoding follows the DOORS client's file output and may need UTF-8 conversion before import. Access restrictions and links to modules not exported can make the result incomplete.

**This script and bridge have not been run against an actual DOORS Classic installation.** It is an export workflow, not a live connection or write-back. Validate output and compatibility with your DOORS version on a test module before use.

Run **Requirements: Test and Update Source Pattern** to select a regex-based source, one of its loaded documents, and its artifact or reference pattern. The command tests the text from the latest scan, lists matching lines and named groups, and offers to save the tested pattern to `traceability.json`. For DOCX, XLSX, and PDF it tests extracted text. If the document or source configuration changes during the workflow, refresh and test again. Saving an empty reference pattern disables it.

Run **Requirements: Open PDF Document** to render a PDF in VS Code with page navigation and zoom. For PDF artifacts, the dashboard also offers **View PDF page** to open the matched page. This visual viewer is read-only; the extracted-text view remains available for regex inspection. The viewer does not yet provide PDF text selection, annotations, or password entry.

Run **Requirements: Open Word Document** to view a DOCX as sanitized, read-only HTML in VS Code. For DOCX artifacts, **View Word document** opens this view. It preserves common document structure such as paragraphs, headings, lists, tables, and supported images, but it is not a pixel-perfect Word renderer and does not edit the original. Tracked changes, comments, page layout, and some embedded content may not be represented; use a Word-compatible editor for authoritative viewing and updates.

Run **Requirements: Open Excel Workbook** to view worksheets and populated rows in a read-only table. For XLSX artifacts, **View workbook row** opens the corresponding sheet and highlights its original row. The viewer shows up to 100 populated rows at a time and limits workbooks to one million represented cells. It shows cached formula results and does not recalculate formulas, edit cells, or reproduce workbook formatting, charts, macros, or images.

### Workbook text edits

The Excel viewer lets users select a cell and edit an existing plain-text cell and save the result as a new `.xlsx` file. It does not overwrite an existing file. Merged, protected, signed, macro-enabled, formula, numeric, rich-text, hyperlink and empty cells are unsupported. The original source is checked for changes before saving. Dependent formula values are not recalculated; open the copy in a spreadsheet application and recalculate before using those results. Saving currently requires a local filesystem destination.

The DOORS Next adapter retrieves each OSLC query member separately to collect its available details and relationships. The account must have permission to read those resources; an inaccessible member fails the import instead of producing partial results. Large queries can take longer because each member requires a request. Actual server compatibility still requires live validation.

Codebeamer sources support `"apiVersion": "v2"` or `"v3"` for cbQL item queries. Omitted `apiVersion` preserves the existing v2 behavior; newly added sources prompt for the version. The v3 query uses `/api/v3/items/query`; association import can use REST v1 or Swagger v3. Select a version supported by the actual server and validate both APIs with its permissions. See [PTC v3 query documentation](https://support.ptc.com/help/codebeamer/r2.2/en/codebeamer/developers_guide/dg_tracker_items_based_on_cbql_query.html).

For Codebeamer associations, set `"includeAssociations": true` and optionally `"associationApi": "v3"` (the default is `v1`), or choose the option when adding a source. V3 reads each item’s incoming and outgoing association IDs and fetches each unique association to obtain its endpoints and type. Only tracker-item source endpoints and tracker-item or URL targets are supported; other association shapes fail the import. This path has mocked tests and needs live-server validation. PTC describes the [v3 relations endpoint](https://support.ptc.com/help/codebeamer/r3.2/en/codebeamer/developers_guide/swagger/dg_inserting_html_code_into_wikitext_field.html).

When a Codebeamer v3 relations response reports additional pages, the adapter stops rather than importing partial associations. Tracker references are distinct from associations and are not yet imported; their presence is reported as a diagnostic so coverage is not mistaken for complete.

The Word viewer offers **Edit text run in copy**. It lets you select and replace one complete XML text run and saves a new local `.docx` without overwriting an existing file. Word may split a sentence across runs, so not every visible selection can be edited this way. Tracked changes, protected, signed, and macro-enabled documents are unsupported. This does not provide general Word editing.

Reference patterns are applied repeatedly to each line, so one line can link to multiple targets. Repeated occurrences of the same target on the same line produce one reference; empty target captures produce diagnostics. Patterns remain line-based.

ReqIFz archives can be added as a `reqifz` source. Import supports exactly one UTF-8 `.reqif` document per archive; attachments are not imported. Navigation opens the extracted XML in a read-only VS Code document.

ReqIF imports resolve enumeration labels and declared relationship type names when definitions are present. Missing enumeration or relationship type definitions produce diagnostics; full ReqIF datatype support remains incomplete.

ReqIF specification hierarchies are retained as artifact placements, including multiple specifications, and displayed in the dashboard and HTML report. Hierarchy placement is not treated as a trace link or included in coverage.

New baselines include imported artifact attributes and specification placements when checking for changes and suspicious links. Older baselines remain readable, but comparisons warn that metadata was not compared; save a new baseline to include it.

In the dashboard matrix, select **+** in an empty cell to add a manual link of that matrix's configured type. Select a manual-link dot to remove that manual record; independently discovered links remain. The link is stored in the project's `traceability-links.json`; it does not modify external DOORS or Codebeamer data. Duplicate or ambiguous artifact identities must be resolved before linking.

ReqIF XHTML text extraction preserves inline reading order and basic paragraph breaks. The extracted view is plain text; formatting, images, tables, and attachments are not faithfully reproduced.

Imported artifact attributes are visible in the dashboard and HTML traceability report. Structured connector values are displayed as escaped JSON text.

Repeated references between the same source artifact and target with the same type are represented as one link; their citation line numbers remain available in the dashboard and HTML report.

The HTML traceability report includes the extracted text for each artifact, along with its attributes, location, and links. Review the report before sharing it, since it can contain requirement and test content from the source documents.

PowerPoint `.pptx` sources support read-only slide text extraction with presentation-order slide locations. A text-only slide viewer supports navigation; faithful visual slide rendering, speaker notes, images, charts, OCR, and general PowerPoint editing are not supported. The text-only viewer can replace a selected text run in a new local copy; signed, protected, and macro-enabled presentations are rejected.

The DOORS Next source wizard accepts an optional HTTPS configuration context URL. It is sent on query and resource requests, and remote link resolution is scoped to that context. Sources configured with different contexts are not implicitly joined. Live validation against the target server is still required.

DOORS Next RDF XML-literal titles and descriptions are converted to ordered plain text with basic paragraph breaks. Formatting and embedded media are not preserved; plain RDF string literals remain unchanged.

Run **Requirements: Inspect Codebeamer Tracker Fields** after importing Codebeamer items to select a tracker field and inspect its v3 field definition in VS Code. The item must expose a tracker ID and the account must have field-read permission. This is read-only and requires the server's v3 API; it does not update the item. Imported tracker, priority, assignee, description format, modification time, and custom fields are retained when provided by the server.

**Experimental Codebeamer name update:** Run **Requirements: Update Codebeamer Item Name (Experimental)**, select an imported item and its tracker field mapped to `name`, and review the proposed value before applying it. The command uses the v3 field-specific API and a five-minute soft lock, rechecks the item version and current name, and attempts to release the lock. Timeouts or server errors can leave the update outcome uncertain; refresh the item before retrying. The same account may be able to remove its lock from another session, so the lock and version check do not guarantee protection against all concurrent edits. This path has mock-based tests only and must be validated with a non-production server before use. That command updates only the item name. The separate description command is described below.

**Experimental Codebeamer description update:** Run **Requirements: Update Codebeamer Description (Experimental)**, choose the item and its description field, edit the raw `Wiki` or `PlainText` content in the opened document, and select **Review update**. Review the diff before choosing **Update in Codebeamer**. The command retains the existing format and uses the same lock, version check, and uncertainty handling as the name update. It has mock-based tests only; validate on a non-production server first. Other fields and links cannot be updated through this command.

For DOORS Next resources, `jazz_rm:primaryText` is used as the artifact's primary text when present; a separate `dcterms:description` is retained as an attribute. If primary text is absent, the description is used as a fallback. RDF XML literals are shown as plain text.

**Experimental DOORS Next title update:** Run **Requirements: Update DOORS Next Title (Experimental)**, choose an imported requirement, and review the new title. The command fetches the full RDF resource, requires a strong ETag, changes one supported plain title in that representation, and sends the full resource with `If-Match`. Paged resources, `xml:base`, nested title markup, ambiguous titles, and resource URLs with queries or fragments are rejected. Server errors or timeouts may leave the outcome uncertain; refresh before retrying. This path has mock-based tests only and must be validated on a non-production server. Other properties and links cannot be edited through the title command.

**Experimental DOORS Next primary-text update:** Run **Requirements: Update DOORS Next Primary Text (Experimental)** and select one text segment from an RDF XML-literal primary-text value. The command preserves surrounding XHTML and unrelated RDF and submits with a strong `If-Match` ETag after review. It supports one single-line segment at a time and rejects `xml:base`, paged resources, comments, CDATA, and processing instructions within primary text. It has only mocked tests and must be validated on a non-production server; a timeout may leave the outcome uncertain.

`npm run test:connector-https` runs simulated DOORS Next and Codebeamer write flows over a local HTTPS server using a temporary test certificate. It requires OpenSSL. The certificate is trusted only by the test client; these tests do not replace live-server validation.
