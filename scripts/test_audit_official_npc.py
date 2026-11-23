import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("audit-official-npc.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture_html(adjusted="", scores=("9", "22", "93", "116")):
    cells = ["100106", adjusted, "Le Biberon 1", "CdP Les Cailloux 1", *scores,
             '<a href="https://www.nlpetanque.nl/NPC/2026-2027/Uitslagen/100106.xlsx">klik hier</a>']
    return ('<table><tr><td colspan="4"><b>2. ZATERDAG 3 OKTOBER</b></td></tr><tr>'
            + "".join(f"<td>{value}</td>" for value in cells) + "</tr></table>")


class OfficialPageTests(unittest.TestCase):
    def parse(self, html):
        return audit.parse_page(html, "1001", audit.PAGES["1001"])

    def test_adjusted_date_does_not_shift_teams_or_exclude_a_published_result(self):
        for adjusted in ("", "21-11-2026"):
            row, = self.parse(fixture_html(adjusted))
            self.assertEqual(row["home"], "Le Biberon 1")
            self.assertEqual(row["away"], "CdP Les Cailloux 1")
            self.assertTrue(row["published"])
            self.assertEqual(row["totals"], [9, 22, 93, 116])
            self.assertEqual(row["roundDate"], "2026-10-03")
            self.assertEqual(row["adjustedDate"], "2026-11-21" if adjusted else None)

    def test_empty_and_zero_scores_are_distinct(self):
        row, = self.parse(fixture_html(scores=("", "", "", "")))
        self.assertFalse(row["published"])
        row, = self.parse(fixture_html(scores=("0", "31", "86", "143")))
        self.assertTrue(row["published"])
        self.assertEqual(row["totals"][0], 0)

    def test_next_year_and_single_digit_adjusted_dates(self):
        row, = self.parse(fixture_html("13-3-2027").replace("2. ZATERDAG 3 OKTOBER", "14. ZATERDAG 3 APRIL"))
        self.assertEqual(row["roundDate"], "2027-04-03")
        self.assertEqual(row["adjustedDate"], "2027-03-13")

    def test_duplicates_partial_totals_bad_dates_and_missing_links_fail_closed(self):
        for html in [
            fixture_html() + fixture_html(),
            fixture_html(scores=("9", "", "93", "116")),
            fixture_html("31-2-2027"),
            fixture_html().replace("100106.xlsx", "100107.xlsx"),
            "<html>temporarily unavailable</html>",
        ]:
            with self.subTest(html=html), self.assertRaises((ValueError, KeyError)):
                self.parse(html)

    def test_untrusted_downloads_and_redirects_are_rejected(self):
        for url in ["http://nlpetanque.nl/a.xlsx", "https://example.com/a.xlsx",
                    "https://nlpetanque.nl:444/a.xlsx", "https://user:pass@nlpetanque.nl/a.xlsx"]:
            with self.assertRaises(ValueError):
                audit.official_url(url)

    def test_published_workbook_404_prevents_successful_snapshot(self):
        responses = [
            {"status": 200, "body": fixture_html("21-11-2026").encode()},
            {"status": 404, "body": b""},
        ]
        with patch.object(audit, "PAGES", {"1001": audit.PAGES["1001"]}), \
                patch.object(audit, "download", side_effect=responses), \
                patch.dict("sys.modules", {"openpyxl": type("Openpyxl", (), {"__version__": "3.1.5"})}):
            with self.assertRaisesRegex(ValueError, "Published result has no workbook"):
                audit.audit()

    def test_page_change_during_download_invalidates_snapshot(self):
        responses = [
            {"status": 200, "body": fixture_html(scores=("", "", "", "")).encode()},
            {"status": 404, "body": b""},
            {"status": 200, "body": fixture_html().encode()},
        ]
        with patch.object(audit, "PAGES", {"1001": audit.PAGES["1001"]}), \
                patch.object(audit, "download", side_effect=responses), \
                patch.dict("sys.modules", {"openpyxl": type("Openpyxl", (), {"__version__": "3.1.5"})}):
            with self.assertRaisesRegex(ValueError, "page changed during audit"):
                audit.audit()


if __name__ == "__main__":
    unittest.main()
