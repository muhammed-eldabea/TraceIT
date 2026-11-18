# Reqtify interface and document support inventory

This inventory groups the interfaces named in the [Reqtify 2025x product overview, pages 14–18](https://www.incose.org/wp-content/uploads/2026/01/demoday_012-catia_reqtify_2025x-product_overview.pdf). An interface name in that document is not a claim that every file extension, operation, or version is supported by this extension. Product integrations may require vendor APIs, credentials, licenses, installed software, or export formats.

| Category | Interfaces identified in the overview | Status in this extension / work needed |
|---|---|---|
| Plain text, source code and markup | Text, HTML, AsciiDoc, Ada, ARXML, C, C++, C#, Java, Modelica, SDL, Verilog, VHDL, MATLAB files | Textual regex extraction and VS Code text editing work when the configured glob and patterns fit. This is not language-aware parsing or structured XML/HTML support. |
| Office and document editors | Word, Excel, Access, Outlook, PowerPoint, Visio, Adobe Acrobat/PDF, FrameMaker, Google Docs/Sheets/Slides, Interleaf, OpenOffice Writer | Initial DOCX, XLSX and PDF extraction and visual viewers are available. PPTX slide text can be opened in a text-only viewer, with selected text-run edits saved to a new copy. Word text runs and Excel plain-text cells can be edited in new copies with the restrictions below. Faithful Word layout, Excel formatting and charts, OCR, general document editing, and the other listed formats are not implemented. |
| Requirement systems | 3DEXPERIENCE Traceable Requirements Management, IBM RequisitePro, DOORS, DOORS Next, PTC Integrity, Siemens Polarion | Experimental DOORS Next import and restricted title and primary-text segment updates, and the DOORS Classic export bridge, require live validation. Other systems need adapters or supported exports. |
| Project, configuration and change systems | ENOVIA Program Central, Microsoft Project, Design Sync, Dimensions, Documentum, PVCS, ClearCase, CM-Synergy, IBM Rational Change, CVS, Git, GitHub, Bitbucket, Jama, Jenkins, Jira, Bugzilla, Perforce, ProjectWise, Subversion, Redmine | Not implemented as integrations. Text files in a Git workspace can be analyzed, but there is no repository history or remote connector. |
| IDEs and text editors | Emacs, MATLAB, NEdit, PsPad, TextPad, UltraEdit, Visual Studio, VS Code, XEmacs | VS Code is the host; generic text files can be opened and edited. No integration with the other editors. |
| Dassault tools | CATIA Functional/Logical Design, ControlBuild, Dymola, STIMULUS; ENOVIA Engineering BOM, Live Collaboration, Program Central, Traceable Requirements, Features, Logical Features, Design Sync, ENOVIAvpm, Project Space; SOLIDWORKS | Not implemented; vendor-specific access and artifact mapping required. |
| Development and design pack | AUTOSAR Builder, CATIA V5, Product Structure Design, Cameo, Teamwork Cloud, ASCET, AutoCAD, AWR, codeBeamer, TeamForge, Capella, Eclipse JDT/CDT/Papyrus, Stood, SCADE, Rhapsody, Statemate, logi.CAD, LabVIEW, Objecteering, RTDS, PTC/Atego Modeler, Enterprise Architect, Simulink/Stateflow, EB tresos | An experimental Codebeamer connector with limited item-name and description write-back requires live validation. Other tools need specific APIs or export parsers. |
| Test pack | vManager, Eclipse RCP Testing Tool, ALM/Quality Center, Rational Test RealTime, Rational Quality Manager, Cantata++, Reliability Workbench, TESSY, TestStand, TPT, SIMULIA Test Manager, TestLink, vTESTstudio, VectorCAST | Not implemented; each requires a test data and result mapping plus an adapter. |
| Database access | Oracle | Not implemented; database connectivity and mapping required. |
| Requirements interchange | ReqIF (described separately in the overview) | Initial read-only ReqIF and single-document UTF-8 ReqIFz import supports object identifiers, simple values, enumeration labels, and typed object-to-object relations. Specification placements are retained as hierarchy context. Attachments, rich-text fidelity, full datatype support, and export are not supported. |

## Views

The overview describes management, coverage, impact/graphical, requirement details, link details, snapshot comparison, and report views. The dashboard provides an initial management and coverage summary, source graph, artifact links, impact traversal and baseline comparison. Manual-link commands are available; rich document tagging and full Reqtify view parity remain unimplemented.

## Document workflow now available

Open a supported text file in VS Code. Run **Requirements: Test Regex in Active Document** to test the first match per line, inspect named groups, and navigate to a match. Edit and save the document using the VS Code editor, then refresh traceability. The tester uses the active editor buffer, including unsaved edits; analysis currently reads saved files from the workspace filesystem. Neither the tester nor analysis modifies documents automatically.

For each future adapter, define extraction, stable artifact identity, source location navigation, supported viewing/editing behavior, and lossless or explicitly limited write-back separately. Converting to text for analysis must not silently overwrite the original document.

### Workbook text edits

The Excel viewer lets users select a cell and edit an existing plain-text cell and save the result as a new `.xlsx` file. It does not overwrite an existing file. Merged, protected, signed, macro-enabled, formula, numeric, rich-text, hyperlink and empty cells are unsupported. The original source is checked for changes before saving. Dependent formula values are not recalculated; open the copy in a spreadsheet application and recalculate before using those results. Saving currently requires a local filesystem destination.

The Word viewer offers **Edit text run in copy**. It lets you select and replace one complete XML text run and saves a new local `.docx` without overwriting an existing file. Word may split a sentence across runs, so not every visible selection can be edited this way. Tracked changes, protected, signed, and macro-enabled documents are unsupported. This does not provide general Word editing.
