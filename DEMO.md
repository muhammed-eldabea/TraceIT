# Requirements Traceability demo

This is a development demo, not a claim of Reqtify feature parity or production readiness. DOORS Next and Codebeamer adapters have mocked tests but need validation against the actual servers and versions. The DOORS Classic DXL export bridge has not been verified on a live installation.

## Prepare

1. Install the current `reqtify-like-0.1.0-demo.vsix` in VS Code with **Extensions: Install from VSIX**.
2. Open the `examples/sample` folder as the VS Code workspace. The sample's `traceability.json` configures requirement and test sources and their `verifies` relationship.
3. Open the **Requirements** activity-bar view and run **Requirements: Refresh Traceability**. If prompted, trust the sample workspace.

## Demonstrate

1. Open `requirements.md` and `tests.md`. `TEST-001` references `REQ-001`; `REQ-002` has no test; `TEST-002` references missing `REQ-999`.
2. Open **Requirements: Open Traceability Dashboard** to inspect artifacts, relationships, coverage, and diagnostics. Navigate from the findings to source files.
3. Run **Requirements: Generate Traceability Report** and **Requirements: Export Traceability Matrix CSV** to show export options.
4. Run **Requirements: Test and Update Source Pattern** to show configurable regular-expression extraction. Save a baseline and preview its comparison after changing a sample file, if time permits.
5. Open an `.xlsx` file with **Requirements: Open Excel Workbook** to show the workbook viewer. Its **Edit text cell in copy** action supports existing plain-text cells only and creates a new local file; formulas are not recalculated. Word and PDF viewers are also available from the command palette.
6. Show the DOORS Next and Codebeamer configuration commands and the DOORS Classic export script. Explain that live connectivity requires a compatible server, credentials, and validation; the offline sample does not demonstrate a live connection.

See [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md) for setup and limitations.

## Multi-format walkthrough

Open `examples/multiformat` as the workspace and refresh traceability. This separate sample includes Markdown requirements, a Word test, an Excel test, a PDF note, PowerPoint slides, and a ReqIF exchange. The expected analysis has nine artifacts, three resolved links, and two coverage rules showing one of two requirements linked. The ReqIF artifact `EXT-101` also shows its specification placement.

Open the dashboard's Word, workbook, and PDF viewer buttons; select **View slide text** on a PowerPoint artifact to open its text-only slide viewer to demonstrate navigation. The Word, Excel, and PowerPoint viewers can save supported text edits to new copies; see the format support document for restrictions. In the matrices, use **+** to add a local manual link and select its dot to remove it. Manual links are saved to `traceability-links.json` in this sample workspace.

The multi-format sample is checked by `node tests/multiformatDemo.test.js`. A separate VS Code extension-host test at `tests/integration/multiformat.js` checks its workspace scan and opens the Word, workbook, and PDF viewers and the extracted PowerPoint text.
