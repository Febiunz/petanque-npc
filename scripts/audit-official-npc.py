"""Capture a complete, validated official-source snapshot, never a partial no-op."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


PAGES = {
    "1001": "https://nlpetanque.nl/topdivisie-2026-2027-1001/",
    "2001": "https://nlpetanque.nl/2e-divisie-2026-2027-2001/",
    "2002": "https://nlpetanque.nl/2e-divisie-2026-2027-2002/",
}
MONTHS = dict(zip(
    "JANUARI FEBRUARI MAART APRIL MEI JUNI JULI AUGUSTUS SEPTEMBER OKTOBER NOVEMBER DECEMBER".split(),
    range(1, 13),
))
SLOTS = [(f"tete-{n}", row, 1, 2) for n, row in enumerate([18, 21, 24, 27, 30, 33], 1)]
SLOTS += [(f"doublette-{n}", row, 2, 3) for n, row in enumerate([39, 43, 47], 1)]
SLOTS += [(f"triplette-{n}", row, 3, 5) for n, row in enumerate([63, 68], 1)]


def text(value):
    return " ".join(str(value).split()) if value is not None else ""


def official_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in {"nlpetanque.nl", "www.nlpetanque.nl"}
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError(f"Untrusted official source URL: {url}")
    return url


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, official_url(newurl))


def download(url):
    official_url(url)
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "NPC-data-refresh", "Cache-Control": "no-cache"})
            with build_opener(OfficialRedirects()).open(request, timeout=30) as response:
                body = response.read(5_000_001)
                if len(body) > 5_000_000:
                    raise ValueError(f"Official source exceeds 5 MB: {url}")
                return {"status": response.status, "url": official_url(response.url), "body": body}
        except HTTPError as error:
            if error.code == 404:
                return {"status": 404, "url": url, "body": b""}
            if error.code < 500 or attempt == 2:
                raise
        except (URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


class TableRows(HTMLParser):
    """Keep actual cells (including empty ones and colspans), not flattened text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "links": [], "span": int(attrs.get("colspan", 1))}
        elif tag == "a" and self.cell is not None and attrs.get("href"):
            self.cell["links"].append(attrs["href"])

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.cell["text"] = text(self.cell["text"])
            self.row.append(self.cell)
            self.row.extend({"text": "", "links": []} for _ in range(self.cell["span"] - 1))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def parse_page(html, pool, page_url):
    parser = TableRows()
    parser.feed(html)
    fixtures = []
    seen = set()
    round_number = None
    round_date = None
    for cells in parser.rows:
        if not cells:
            continue
        first = cells[0]["text"]
        heading = re.fullmatch(r"(\d+)\.\s+\w+\s+(\d{1,2})\s+([A-Z]+)", first)
        if heading:
            round_number = int(heading[1])
            month = MONTHS[heading[3]]
            round_date = date(2026 if month >= 7 else 2027, month, int(heading[2])).isoformat()
            continue
        if not re.fullmatch(r"\d{6}", first):
            continue
        if not first.startswith(pool) or first in seen or len(cells) < 9 or not round_date:
            raise ValueError(f"Invalid/duplicate official fixture row: {first}")
        seen.add(first)
        adjusted = cells[1]["text"]
        if adjusted:
            match = re.fullmatch(r"(\d{1,2})-(\d{1,2})-(\d{4})", adjusted)
            if not match:
                raise ValueError(f"Unrecognized adjusted date for {first}: {adjusted}")
            adjusted = date(int(match[3]), int(match[2]), int(match[1])).isoformat()
        scores = [cell["text"] for cell in cells[4:8]]
        if any(scores) and not all(re.fullmatch(r"\d+", score) for score in scores):
            raise ValueError(f"Incomplete published totals for {first}: {scores}")
        links = [official_url(urljoin(page_url, link)) for link in cells[8]["links"]]
        links = [url for url in links if urlsplit(url).path.endswith(f"/Uitslagen/{first}.xlsx")]
        if len(links) != 1 or not cells[2]["text"] or not cells[3]["text"]:
            raise ValueError(f"Missing workbook or team identity for {first}")
        fixtures.append({
            "matchId": first, "round": round_number,
            "home": cells[2]["text"], "away": cells[3]["text"],
            "roundDate": round_date, "adjustedDate": adjusted or None,
            "published": bool(any(scores)),
            "totals": list(map(int, scores)) if any(scores) else None,
            "workbookUrl": links[0],
        })
    if not fixtures:
        raise ValueError(f"No official fixture rows parsed for {pool}")
    return fixtures


def parse_sheet(sheet, fixture):
    mid = fixture["matchId"]
    if ("wedstrijd" not in text(sheet["A7"].value).lower()
            or "datum" not in text(sheet["G7"].value).lower()
            or str(sheet["D7"].value) != mid
            or text(sheet["A11"].value) != fixture["home"]
            or text(sheet["G11"].value) != fixture["away"]):
        raise ValueError(f"Workbook identity/layout mismatch: {mid}")
    played = sheet["J7"].value
    if not isinstance(played, (date, datetime)):
        raise ValueError(f"Missing played date in workbook: {mid}")
    played = played.date().isoformat() if isinstance(played, datetime) else played.isoformat()
    if fixture["adjustedDate"] and fixture["adjustedDate"] != played:
        raise ValueError(f"Adjusted page date and played workbook date disagree: {mid}")
    for cell, label in [("A16", "tête"), ("A38", "doublette"), ("A62", "triplette"),
                        ("M17", "uitslag"), ("P17", "punten")]:
        if label not in text(sheet[cell].value).lower():
            raise ValueError(f"Workbook game layout changed: {mid} {cell}")
    games = []
    lineup = {"source": fixture["workbookUrl"], "games": {}, "substitutions": []}
    missing = []
    weighted = [0, 0]
    raw = [0, 0]
    for slot, row, size, points in SLOTS:
        pair = [sheet.cell(row, col).value for col in (13, 14)]
        if (any(type(score) is not int or score < 0 or score > 13 for score in pair)
                or sorted(pair)[1] != 13 or sorted(pair)[0] == 13):
            raise ValueError(f"Invalid/incomplete workbook game: {mid} {slot}")
        games.append({"slotId": slot, "homeScore": pair[0], "awayScore": pair[1]})
        for side in range(2):
            weighted[side] += points if pair[side] == 13 else 0
            raw[side] += pair[side]
        lineup["games"][slot] = {}
        for side, col in [("home", "C"), ("away", "I")]:
            names = []
            for offset in range(size):
                cell = f"{col}{row + offset}"
                value = sheet[cell].value
                if value is None or value == "" or (isinstance(value, str) and value.startswith("#")):
                    missing.append({"slotId": slot, "side": side, "cell": cell})
                elif not isinstance(value, str) or not text(value):
                    raise ValueError(f"Invalid player name: {mid} {cell}")
                else:
                    names.append(text(value))
            lineup["games"][slot][side] = names
    totals = weighted + raw
    if totals != fixture["totals"] or totals != [sheet[cell].value for cell in ("P13", "Q13", "M13", "N13")]:
        raise ValueError(f"Page/workbook/derived totals disagree: {mid}")
    unassigned = []
    for kind, rows in [("doublette", [51, 54, 57]), ("triplette", [73, 76])]:
        for row in rows:
            for side, col, label in [("home", "C", "A"), ("away", "I", "G")]:
                outgoing, incoming = (text(sheet[f"{col}{r}"].value) or None for r in (row, row + 1))
                if not outgoing and not incoming:
                    continue
                if (text(sheet[f"{label}{row}"].value).upper() != "UIT:"
                        or text(sheet[f"{label}{row + 1}"].value).upper() != "IN:"):
                    raise ValueError(f"Substitution layout changed: {mid} {row}")
                slots = [slot for slot, sides in lineup["games"].items()
                         if slot.startswith(kind) and outgoing and outgoing in sides[side]]
                if len(slots) == 1 and incoming:
                    lineup["substitutions"].append({"slotId": slots[0], "side": side, "out": outgoing, "in": incoming})
                else:
                    unassigned.append({"type": kind, "side": side, "out": outgoing, "in": incoming})
    if unassigned:
        lineup["unassignedSubstitutions"] = unassigned
    result = {"date": played, "games": games, "playerLineup": lineup}
    if missing:
        result["missingPlayerNames"] = missing
    return result


def audit():
    import openpyxl

    if openpyxl.__version__ != "3.1.5":
        raise ValueError("Use openpyxl==3.1.5 for the audited workbook layout")
    report = {"kind": "official-npc-snapshot-v1", "generatedAt": datetime.now(timezone.utc).isoformat(), "pools": {}}
    for pool, url in PAGES.items():
        response = download(url)
        if response["status"] != 200:
            raise ValueError(f"Official page unavailable: {url}")
        fixtures = parse_page(response["body"].decode("utf-8"), pool, url)
        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(executor.map(download, [row["workbookUrl"] for row in fixtures]))
        for fixture, workbook in zip(fixtures, responses):
            fixture["workbookStatus"] = workbook["status"]
            if workbook["status"] == 404:
                if fixture["published"]:
                    raise ValueError(f"Published result has no workbook (not an unpublished fixture): {fixture['matchId']}")
                continue
            if not fixture["published"]:
                raise ValueError(f"Workbook is available but page totals are missing: {fixture['matchId']}")
            document = openpyxl.load_workbook(BytesIO(workbook["body"]), data_only=True, keep_links=False)
            sheets = [sheet for sheet in document if sheet.title.startswith("3.")]
            if len(sheets) != 1:
                raise ValueError(f"Unknown workbook sheet layout: {fixture['matchId']}")
            fixture["workbook"] = {
                **parse_sheet(sheets[0], fixture),
                "sha256": sha256(workbook["body"]).hexdigest(),
                "resolvedUrl": workbook["url"],
            }
            document.close()
        # A page updated during downloads invalidates this snapshot instead of becoming a false no-op.
        refreshed = download(url)
        if refreshed["status"] != 200 or parse_page(refreshed["body"].decode("utf-8"), pool, url) != [
            {key: value for key, value in row.items() if key not in ("workbookStatus", "workbook")}
            for row in fixtures
        ]:
            raise ValueError(f"Official page changed during audit; retry a fresh snapshot: {pool}")
        report["pools"][pool] = {
            "pageUrl": url, "pageSha256": sha256(response["body"]).hexdigest(), "fixtures": fixtures,
        }
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    snapshot = audit()
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for pool, source in snapshot["pools"].items():
        print(f"{pool}: {len(source['fixtures'])} fixtures, "
              f"{sum(row['published'] for row in source['fixtures'])} verified published results")
