#!/usr/bin/env python3
"""Prepare reviewed, data-free SIT templates with Python's standard library.

Developer-only, offline asset preparation. Supply four worklists in catalog order
(main, variant 1, variant 2, variant 3), the issues workbook, and the cases workbook.
The originals are read only. Header positions are defined by the reviewed layout;
--layout-maps may supply richer metadata but must match each original's SHA256.
Inspect newly supplied headers before publishing: this is not a general-purpose
anonymizer for arbitrary workbooks. No test execution or Office render is claimed.

ZIP entries use a fixed timestamp and deterministic ordering. Identical inputs and
the same Python/zlib runtime yield identical assets and profiles. Source styles,
row attributes, columns, merges, views, print settings and formulas are preserved;
old values, formula caches, comments, links, media and private metadata are removed.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr
import zipfile


SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOCUMENT_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"x": SHEET_NS}
MAX_BYTES = 64 * 1024 * 1024
MAX_PARTS = 4096
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
WORKLIST_HEADERS = {
    "0.测试前置事项": (1, [1]),
    "1.测试资产清单": (2, [2]),
    "2.业务场景抽象": (2, [2, 10, 20, 32, 51, 56]),
    "3.测试用例（流程）": (3, [2, 3]),
    "4.测试用例（流程组合）": (2, [2]),
    "5.数据用例": (2, [2]),
    "6.功能测试": (2, [2]),
    "7.接口测试": (2, [2]),
    "8.测试计划": (1, [1]),
    "9.问题记录": (2, [2]),
    "10.专项测试": (2, [2]),
    "11.测试方案": (2, [2]),
    "12.测试报告": (2, [2]),
}
PRIVATE_PREFIXES = (
    "docProps/", "customXml/", "xl/media/", "xl/drawings/", "xl/comments",
    "xl/threadedComments/", "xl/persons/", "xl/externalLinks/", "xl/embeddings/",
    "xl/activeX/", "xl/ctrlProps/", "xl/queryTables/", "xl/pivotCaches/",
    "xl/pivotTables/", "xl/revisions/", "xl/tables/",
)
PRIVATE_FILES = {"xl/sharedStrings.xml", "xl/metadata.xml", "xl/connections.xml", "xl/vbaProject.bin"}
WORKSHEET_REMOVED_ELEMENTS = (
    "hyperlinks", "drawing", "legacyDrawing", "legacyDrawingHF", "picture",
    "oleObjects", "controls", "tableParts", "pivotTableParts",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_xml(data, part):
    if re.search(br"<!DOCTYPE|<!ENTITY", data, re.I):
        raise ValueError(f"Entities or DTD are unsupported: {part}")
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise ValueError(f"Invalid XML in {part}: {error}") from error


def read_workbook(source):
    data = source.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError(f"Workbook is too large: {source.name}")
    parts = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        if len(entries) > MAX_PARTS or sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("Workbook exceeds preparation size limits")
        for entry in entries:
            name = entry.filename
            if name in parts or name.startswith("/") or "\\" in name or ".." in PurePosixPath(name).parts:
                raise ValueError(f"Unsafe or duplicate ZIP part: {name}")
            parts[name] = archive.read(entry)
    for part, content in parts.items():
        if part.endswith((".xml", ".rels")) or part == "[Content_Types].xml":
            parse_xml(content, part)
    for required in ["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]:
        if required not in parts:
            raise ValueError(f"Missing required workbook part: {required}")
    return data, parts


def owner_of_relationships(part):
    if part == "_rels/.rels":
        return ""
    path = PurePosixPath(part)
    if path.parent.name != "_rels" or not path.name.endswith(".rels"):
        raise ValueError(f"Invalid relationships part: {part}")
    return str(path.parent.parent / path.name[:-5])


def relationship_target(owner, target):
    if not target or "\\" in target or ":" in target or "#" in target:
        raise ValueError(f"Unsupported internal relationship target: {target}")
    base = PurePosixPath(owner).parent if owner else PurePosixPath("")
    candidate = PurePosixPath(target.lstrip("/")) if target.startswith("/") else base / target
    normalized = []
    for segment in candidate.parts:
        if segment == "..":
            if not normalized:
                raise ValueError("Relationship target escapes the workbook")
            normalized.pop()
        elif segment != ".":
            normalized.append(segment)
    return "/".join(normalized)


def worksheet_catalog(parts):
    root = parse_xml(parts["xl/workbook.xml"], "xl/workbook.xml")
    relationships = parse_xml(parts["xl/_rels/workbook.xml.rels"], "workbook relationships")
    targets = {rel.attrib["Id"]: relationship_target("xl/workbook.xml", rel.attrib["Target"])
               for rel in relationships if rel.attrib.get("TargetMode") != "External"}
    sheets = []
    for sheet in root.findall("x:sheets/x:sheet", NS):
        identifier = sheet.attrib[f"{{{DOCUMENT_REL_NS}}}id"]
        part = targets.get(identifier)
        if not part or part not in parts:
            raise ValueError(f"Missing worksheet target: {sheet.attrib['name']}")
        sheets.append({"name": sheet.attrib["name"], "part": part})
    return sheets


def cell_values(parts, sheet):
    shared = []
    if "xl/sharedStrings.xml" in parts:
        root = parse_xml(parts["xl/sharedStrings.xml"], "shared strings")
        shared = ["".join(item.itertext()) for item in root]
    root = parse_xml(parts[sheet], sheet)
    values = {}
    for cell in root.findall(".//x:c", NS):
        value = cell.find("x:v", NS)
        text = (value.text or "") if value is not None else ""
        if cell.attrib.get("t") == "s" and text:
            try:
                text = shared[int(text)]
            except (ValueError, IndexError) as error:
                raise ValueError(f"Invalid shared string index in {sheet}") from error
        elif cell.attrib.get("t") == "inlineStr":
            inline = cell.find("x:is", NS)
            text = "".join(inline.itertext()) if inline is not None else ""
        values[cell.attrib["r"]] = {"value": text, "type": cell.attrib.get("t"), "styleId": cell.attrib.get("s")}
    return root, values


def load_layout_maps(path):
    if path is None:
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    workbooks = document.get("workbooks")
    if not isinstance(workbooks, list):
        raise ValueError("layout-maps requires a workbooks array")
    mapped = {}
    for workbook in workbooks:
        digest = workbook.get("sourceSha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or digest in mapped:
            raise ValueError("Invalid or duplicate layout-map sourceSha256")
        mapped[digest] = {sheet["sheetPart"]: sheet for sheet in workbook["sheets"]}
    return mapped


def sheet_metadata(kind, index, sheet, values, root, audited):
    if kind == "worklist":
        if sheet["name"] not in WORKLIST_HEADERS:
            raise ValueError(f"Unreviewed worklist sheet: {sheet['name']}")
        header_row, header_rows = WORKLIST_HEADERS[sheet["name"]]
    else:
        header_row, header_rows = (5, [5]) if kind == "issues" and index == 0 else (1, [1])
    data_start = None if kind == "issues" and index == 0 else header_row + 1
    fill_mode = "summary-formulas-read-only" if data_start is None else "table-rows-with-merged-groups"
    if kind == "worklist" and sheet["name"] == "2.业务场景抽象":
        fill_mode = "section-matrix-specified-cell"
    if audited:
        if audited["name"] != sheet["name"]:
            raise ValueError("layout-map sheet name/part mismatch")
        header_row = audited["headerRow"]
        header_rows = audited.get("headerRows", [header_row])
        data_start = audited["dataStartRow"]
        fill_mode = audited["fillMode"]
    # Summary header metadata must never become a data-clearing boundary.
    if kind == "issues" and index == 0:
        data_start, fill_mode = None, "summary-formulas-read-only"
    headers = []
    for ref, info in values.items():
        if int(re.search(r"\d+$", ref).group()) == header_row and info["value"]:
            headers.append({"cell": ref, "column": re.sub(r"\d+$", "", ref), "label": info["value"], "styleId": info["styleId"]})
    if audited and [(cell["cell"], cell["label"]) for cell in audited["headerCells"]] != [(cell["cell"], cell["label"]) for cell in headers]:
        raise ValueError("layout-map headers differ from the actual source cells")
    geometry = {"rowAttributes": [row.attrib for row in root.findall("x:sheetData/x:row", NS)]}
    for name in ["cols", "mergeCells", "sheetViews", "sheetFormatPr", "pageSetup", "pageMargins", "printOptions"]:
        node = root.find(f"x:{name}", NS)
        geometry[name] = ET.tostring(node, encoding="unicode") if node is not None else None
    metadata = {**sheet, "headerRow": header_row, "headerRows": header_rows, "dataStartRow": data_start,
                "headers": [{"ref": cell["cell"], "label": cell["label"]} for cell in headers],
                "headerCells": headers, "fillMode": fill_mode,
                "layoutHash": audited["layoutHash"] if audited else sha256(json.dumps(geometry, sort_keys=True, ensure_ascii=False).encode())}
    if audited and audited.get("sectionHeaderCells"):
        metadata["sectionHeaderCells"] = audited["sectionHeaderCells"]
    return metadata


def remove_elements(text, names):
    for name in names:
        text = re.sub(rf"<{name}\b[^>]*?(?:/>|>.*?</{name}>)", "", text, flags=re.S)
    return text


def sanitize_sheet(content, values, metadata, summary=False):
    text = content.decode("utf-8")
    header_rows = set(metadata["headerRows"])

    def sanitize(match):
        opening, body = match.group(1), match.group(2) or ""
        reference = re.search(r'\br="([A-Z]+)(\d+)"', opening)
        if not reference:
            raise ValueError("Worksheet cell lacks a supported reference")
        ref, row = reference.group(1) + reference.group(2), int(reference.group(2))
        info = values[ref]
        opening = re.sub(r'\s+(?:t|vm|cm)="[^"]*"', "", opening)
        if re.search(r"<f\b", body):
            body = re.sub(r"<v\b[^>]*?(?:/>|>.*?</v>)", "", body, flags=re.S)
            return opening + ">" + body + "</c>"
        keep = row in header_rows or summary and info["type"] in ("s", "inlineStr", "str")
        if keep and info["value"]:
            value = escape(info["value"], {'"': '&quot;', "'": '&apos;'})
            return opening + ' t="inlineStr"><is><t xml:space="preserve">' + value + "</t></is></c>"
        return opening + "/>"

    text = re.sub(r"(<c\b[^>]*?)(?:/>|>(.*?)</c>)", sanitize, text, flags=re.S)
    return remove_elements(text, WORKSHEET_REMOVED_ELEMENTS).encode("utf-8")


def serialize_elements(root_name, namespace, children):
    body = []
    for child in children:
        name = child.tag.split("}")[-1]
        attrs = " ".join(f"{key}={quoteattr(value)}" for key, value in child.attrib.items())
        body.append(f"<{name} {attrs}/>")
    return (f'<?xml version="1.0" encoding="UTF-8"?><{root_name} xmlns="{namespace}">'
            + "".join(body) + f"</{root_name}>").encode()


def clean_package(parts):
    removed = {part for part in parts if part in PRIVATE_FILES or part.startswith(PRIVATE_PREFIXES)}
    for part in removed:
        del parts[part]
    workbook = parts["xl/workbook.xml"].decode("utf-8")
    # Custom names can carry private identifiers/URLs. Only actual print ranges are retained.
    def keep_print_name(match):
        opening = match.group(1)
        name = re.search(r'\bname="([^"]+)"', opening)
        return match.group(0) if name and name.group(1) in ("_xlnm.Print_Area", "_xlnm.Print_Titles") else ""

    workbook = re.sub(r"(<definedName\b[^>]*?)(?:/>|>.*?</definedName>)", keep_print_name, workbook, flags=re.S)
    parts["xl/workbook.xml"] = remove_elements(workbook, ["externalReferences", "fileSharing"]).encode()
    for part in list(parts):
        if not part.endswith(".rels"):
            continue
        owner = owner_of_relationships(part)
        if owner and owner not in parts:
            del parts[part]
            continue
        root = parse_xml(parts[part], part)
        kept = []
        for relationship in root:
            if relationship.attrib.get("TargetMode") == "External":
                continue
            target = relationship_target(owner, relationship.attrib["Target"])
            if target in parts:
                kept.append(relationship)
        parts[part] = serialize_elements("Relationships", PACKAGE_REL_NS, kept)
    content_types = parse_xml(parts["[Content_Types].xml"], "[Content_Types].xml")
    extensions = {PurePosixPath(part).suffix[1:] for part in parts}
    kept = [element for element in content_types
            if element.tag.endswith("}Override") and element.attrib["PartName"].lstrip("/") in parts
            or element.tag.endswith("}Default") and element.attrib["Extension"] in extensions]
    parts["[Content_Types].xml"] = serialize_elements("Types", CONTENT_NS, kept)


def validate_package(parts):
    relationships_by_owner = {}
    for part, content in parts.items():
        if part.endswith((".xml", ".rels")) or part == "[Content_Types].xml":
            root = parse_xml(content, part)
            if part.endswith(".rels"):
                owner = owner_of_relationships(part)
                identifiers = set()
                for rel in root:
                    if rel.attrib.get("TargetMode") == "External" or relationship_target(owner, rel.attrib["Target"]) not in parts:
                        raise ValueError(f"Dangling or external relationship: {part}")
                    if rel.attrib["Id"] in identifiers:
                        raise ValueError(f"Duplicate relationship identity: {part}")
                    identifiers.add(rel.attrib["Id"])
                relationships_by_owner[owner] = identifiers
    for part, content in parts.items():
        if not part.endswith(".xml"):
            continue
        root = parse_xml(content, part)
        for node in root.iter():
            for attribute, identifier in node.attrib.items():
                if attribute.startswith("{" + DOCUMENT_REL_NS + "}") and identifier not in relationships_by_owner.get(part, set()):
                    raise ValueError(f"XML references a removed relationship: {part}/{identifier}")
        if part.startswith("xl/worksheets/") and root.findall('.//x:c[@t="s"]', NS):
            raise ValueError("Unconverted shared string value remains")
    root = parse_xml(parts["[Content_Types].xml"], "[Content_Types].xml")
    defaults = {node.attrib["Extension"] for node in root if node.tag.endswith("}Default")}
    overrides = {node.attrib["PartName"].lstrip("/") for node in root if node.tag.endswith("}Override")}
    for element in root:
        if element.tag.endswith("}Override") and element.attrib["PartName"].lstrip("/") not in parts:
            raise ValueError("Dangling content type override")
    for part in parts:
        if part != "[Content_Types].xml" and part not in overrides and part.rsplit(".", 1)[-1] not in defaults:
            raise ValueError(f"Missing content type for retained part: {part}")


def deterministic_zip(parts):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(parts):
            info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, parts[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def prepare(identifier, source, kind, maps, maps_required):
    original, parts = read_workbook(source)
    digest = sha256(original)
    audited = maps.get(digest, {})
    if maps_required and kind != "cases" and not audited:
        raise ValueError(f"No SHA256-bound layout map for {identifier}")
    sheets = worksheet_catalog(parts)
    if len(sheets) != {"worklist": 13, "issues": 9, "cases": 2}[kind]:
        raise ValueError(f"Unreviewed sheet count for {identifier}")
    metadata = []
    for index, sheet in enumerate(sheets):
        root, values = cell_values(parts, sheet["part"])
        mapped = audited.get(sheet["part"])
        if audited and mapped is None:
            raise ValueError(f"Missing sheet in layout map: {sheet['part']}")
        item = sheet_metadata(kind, index, sheet, values, root, mapped)
        parts[sheet["part"]] = sanitize_sheet(parts[sheet["part"]], values, item, summary=kind == "issues" and index == 0)
        metadata.append(item)
    if kind == "cases":
        old_name = sheets[0]["name"]
        workbook = parts["xl/workbook.xml"].decode("utf-8")
        workbook = workbook.replace(f'name={quoteattr(old_name)}', 'name="测试用例"')
        parts["xl/workbook.xml"] = workbook.encode()
        metadata[0]["name"] = "测试用例"
    clean_package(parts)
    validate_package(parts)
    result = deterministic_zip(parts)
    profile = {"id": identifier, "file": identifier + ".xlsx", "kind": kind,
               "sourceSha256": digest, "sha256": sha256(result),
               "stylesSha256": sha256(parts["xl/styles.xml"]), "sheets": metadata, "renderVerified": False}
    if sha256(source.read_bytes()) != digest:
        raise ValueError("Source changed during preparation; no asset published")
    return result, profile


def write_assets(destination, files, sources):
    destination = destination.absolute()
    if destination != destination.resolve():
        raise ValueError("Destination symlink paths are unsupported")
    for name in files:
        target = destination / name
        if target.is_symlink() or target.resolve() in sources:
            raise ValueError("Asset output could overwrite an original or a symlink")
        if target.exists() and not target.is_file():
            raise ValueError("Asset output is not a regular file")
    destination.mkdir(parents=True, exist_ok=True)
    before = {name: (destination / name).read_bytes() if (destination / name).exists() else None for name in files}
    with tempfile.TemporaryDirectory(prefix=".wl-sit-prepare-", dir=destination.parent) as staging:
        staging = Path(staging)
        for name, data in files.items():
            (staging / name).write_bytes(data)
        changed = []
        try:
            for name in files:
                os.replace(staging / name, destination / name)
                changed.append(name)
        except OSError:
            for name in changed:
                if before[name] is None:
                    (destination / name).unlink()
                else:
                    (staging / name).write_bytes(before[name])
                    os.replace(staging / name, destination / name)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--worklist", action="append", required=True, help="Repeat exactly four times: main, variant 1, variant 2, variant 3")
    parser.add_argument("--issues", required=True, help="Original nine-sheet issue workbook")
    parser.add_argument("--cases", required=True, help="Original two-sheet case/story workbook")
    parser.add_argument("--layout-maps", type=Path, help="Optional reviewed metadata JSON, bound to sourceSha256")
    parser.add_argument("--dest", type=Path, default=Path(__file__).resolve().parents[1] / "lib/templates/sit")
    args = parser.parse_args()
    if len(args.worklist) != 4:
        parser.error("Exactly four --worklist inputs are required")
    inputs = [("worklist" + (f"-{index}" if index else ""), Path(value).resolve(strict=True), "worklist")
              for index, value in enumerate(args.worklist)]
    inputs += [("issues", Path(args.issues).resolve(strict=True), "issues"), ("cases", Path(args.cases).resolve(strict=True), "cases")]
    if len({source for _, source, _ in inputs}) != 6:
        parser.error("Six distinct original workbooks are required")
    maps = load_layout_maps(args.layout_maps)
    files, profiles = {}, []
    for identifier, source, kind in inputs:
        asset, profile = prepare(identifier, source, kind, maps, args.layout_maps is not None)
        files[profile["file"]] = asset
        profiles.append(profile)
    files["profiles.json"] = (json.dumps({"schemaVersion": 1, "templates": profiles}, ensure_ascii=False, indent=2) + "\n").encode()
    write_assets(args.dest, files, {source for _, source, _ in inputs})
    print(json.dumps([{"id": profile["id"], "bytes": len(files[profile["file"]]), "sheets": len(profile["sheets"]), "sha256": profile["sha256"]} for profile in profiles]))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        raise SystemExit(f"SIT template preparation failed: {error}") from error
