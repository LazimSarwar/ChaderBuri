"""Expand public/data/missions.json to the full CLPS delivery catalog (19 entries).

Flown entries keep their landingUTC / sunAtTouchdown / siteSlug exactly — the
Validation page re-derives their touchdown Sun angles live. Sources curated
17 Oct 2026 from NASA CLPS announcements, provider pages, SpaceNews and
Wikipedia; thin claims carry unconfirmed: true. Run: python scripts/build_missions_catalog.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
P = ROOT / "public" / "data" / "missions.json"
REVIEW = "2026-10-17"

old = {m["name"]: m for m in json.loads(P.read_text(encoding="utf-8"))}


def enrich(base, **kw):
    m = dict(base)
    m.update(kw)
    m.setdefault("lastReviewed", REVIEW)
    return m


# Flown entries: keep landingUTC/sunAtTouchdown/siteSlug exactly (Validation depends on them)
IM1_COORDINATE_NOTE = " Refined trajectory analyses place the touchdown near 80.13 S, 1.44 E; the displayed site keeps the original reported coordinates for consistency with its duty-cycle series."
im1 = enrich(old["IM-1 Odysseus"],
    vehicle="Nova-C 'Odysseus'", launchDate="2024-02-15", launchPrecision="day",
    coordinateKind="landing-site", payloadCount=6,
    note=old["IM-1 Odysseus"]["note"].replace(IM1_COORDINATE_NOTE, '').rstrip() + IM1_COORDINATE_NOTE)
bg1 = enrich(old["Blue Ghost 1"],
    vehicle="Blue Ghost", launchDate="2025-01-15", launchPrecision="day",
    coordinateKind="landing-site", payloadCount=10)
im2 = enrich(old["IM-2 Athena"],
    vehicle="Nova-C 'Athena'", launchDate="2025-02-27", launchPrecision="day",
    coordinateKind="landing-site", payloadCount=None, status="partially-flown")
im3 = enrich(old["IM-3"],
    vehicle="Nova-C", status="upcoming", landingUTC=None, lat=7.5, lonEast=-59.0,
    target="Reiner Gamma", launchWindow="NET 2027 Q1", launchPrecision="quarter",
    coordinateKind="region-centre", payloadCount=12,
    note="CLPS task order CP-11. Slipped from H2 2026 to the first part of 2027. Carries 12 payloads including NASA's CADRE rovers and Lunar Vertex to the Reiner Gamma swirl.",
    sourceUrls=["https://en.wikipedia.org/wiki/IM-3", "https://www.nasa.gov/event/clps-flight-intuitive-machines-im-3"])
bg2 = enrich(old["Blue Ghost 2"],
    vehicle="Blue Ghost + Elytra Dark", status="upcoming", landingUTC=None, lat=None, lonEast=None,
    target="Lunar far side (radio-quiet site)", launchWindow="NET 2027", launchPrecision="year",
    coordinateKind=None, payloadCount=6,
    note="CLPS task order CS-3. Elytra Dark transfer stage plus a far-side lander carrying six payloads from five countries, including the LuSEE-Night radio telescope. Slipped from 2026 to NET 2027.",
    sourceUrls=["https://fireflyspace.com/missions/blue-ghost-mission-2/",
                "https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"])


def upcoming(**kw):
    kw.setdefault("landingUTC", None)
    kw.setdefault("lat", None)
    kw.setdefault("lonEast", None)
    kw.setdefault("siteSlug", None)
    kw.setdefault("sunAtTouchdown", None)
    kw.setdefault("status", "upcoming")
    kw.setdefault("launchPrecision", "year")
    kw.setdefault("coordinateKind", None)
    kw.setdefault("payloadCount", None)
    kw.setdefault("lastReviewed", REVIEW)
    kw.setdefault("sources", "NASA CLPS announcements and provider mission pages. Curated snapshot, not a live manifest.")
    return kw


missions = [
    im1, bg1, im2, im3, bg2,
    upcoming(name="Griffin Mission One", provider="Astrobotic", vehicle="Griffin",
        launchDate="2026-11", launchWindow="NET Nov 2026", launchPrecision="month",
        target="Nobile Crater region, lunar south pole",
        note="In final integration and environmental testing after repeated slips; carries the Astrolab FLIP rover after NASA's VIPER rover was cancelled in 2024. The next candidate CLPS launch.",
        sourceUrls=["https://en.wikipedia.org/wiki/Griffin_Mission_One",
                    "https://www.nasa.gov/event/clps-flight-astrobotics-griffin-mission-one"]),
    upcoming(name="IM-4", provider="Intuitive Machines", vehicle="Nova-C",
        launchDate="2027", launchWindow="2027", target="Lunar south pole region", payloadCount=6,
        note="Awarded August 2024 (task order CP-22). Six NASA payloads to study south-polar volatiles.",
        sourceUrls=["https://www.nasa.gov/news-release/nasa-awards-intuitive-machines-lunar-south-pole-research-delivery"]),
    upcoming(name="Blue Ghost 3", provider="Firefly Aerospace", vehicle="Blue Ghost + Elytra",
        launchDate="2028", launchWindow="2028", target="Gruithuisen Domes",
        lat=36.46, lonEast=-40.8, coordinateKind="approximate", payloadCount=6,
        note="Awarded December 2024 (task order CP-21). Six NASA instruments including Lunar-VISE to Mons Gruithuisen Gamma, plus an Elytra orbital element. Coordinates approximate the region, not a published landing ellipse.",
        sourceUrls=["https://fireflyspace.com/missions/blue-ghost-elytra-gruithuisen-domes"]),
    upcoming(name="Blue Ghost 4", provider="Firefly Aerospace", vehicle="Blue Ghost",
        launchDate="2029", launchWindow="2029", target="Lunar south pole region", payloadCount=5,
        note="Awarded July 2025 (task order CS-6). First multi-rover CLPS delivery: two rovers plus NASA-sponsored instruments to the south pole.",
        sourceUrls=["https://fireflyspace.com/news/firefly-awarded-177-million-nasa-contract-for-mission-to-the-moons-south-pole"]),
    upcoming(name="Blue Moon Pathfinder 1", provider="Blue Origin", vehicle="Blue Moon Mark 1",
        launchDate="2027", launchWindow="2027", target="Shackleton Connecting Ridge",
        note="CLPS task order TO CT-3. Mark 1 demonstration flight carrying NASA stereo cameras and a laser retroreflector; de-risks future Artemis crewed landings. Launch timing not firm.",
        sourceUrls=["https://www.nasa.gov/event/clps-flight-blue-origins-blue-moon-mark-1"]),
    upcoming(name="IM-5", provider="Intuitive Machines", vehicle="Nova-D",
        launchDate="2030", launchWindow="2030", target="Mons Malapert", payloadCount=7,
        note="Awarded March 2026. First CLPS use of the larger Nova-D lander, seven payloads including Australia's Roo-ver rover.",
        sourceUrls=["https://www.nasa.gov/missions/artemis/clps/nasa-selects-intuitive-machines-to-deliver-artemis-science-tech-to-moon"]),
    upcoming(name="Blue Moon Pathfinder 2", provider="Blue Origin", vehicle="Blue Moon Mark 1 (SN002)",
        launchDate="2027", launchWindow="2027", target="Lunar south pole region (reported)", unconfirmed=True,
        note="Second Mark 1 flight to the south pole, reported as an opportunity to carry NASA's VIPER rover (rebaselined after the 2024 cancellation). Thinly sourced - treat details as provisional.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"]),
    upcoming(name="Peregrine 2", provider="Astrobotic", vehicle="Peregrine",
        launchDate="2028", launchWindow="2028", target=None, unconfirmed=True,
        note="Awarded 30 June 2026 in NASA's four-mission CLPS round. Details not yet published.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"]),
    upcoming(name="Peregrine 3", provider="Astrobotic", vehicle="Peregrine",
        launchDate="2028", launchWindow="2028", target=None, unconfirmed=True,
        note="Awarded 30 June 2026 alongside Peregrine 2. Details not yet published.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"]),
    upcoming(name="IM-6", provider="Intuitive Machines", vehicle="Nova-C",
        launchDate="2028", launchWindow="2028", target=None, unconfirmed=True,
        note="Announced 30 June 2026 as Intuitive Machines' sixth CLPS award (up to $148.3M). Details not yet published.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"]),
    upcoming(name="Blue Ghost 5", provider="Firefly Aerospace", vehicle="Blue Ghost",
        launchDate="2028", launchWindow="2028", target="Lunar near side (reported)", unconfirmed=True,
        note="Awarded 30 June 2026 (Firefly's sixth CLPS task order). Near-side delivery reported; details not yet published.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"]),
    dict(name="Masten Mission One", provider="Masten Space Systems", vehicle="XL-1",
        status="cancelled", landingUTC=None, lat=None, lonEast=None, siteSlug=None, sunAtTouchdown=None,
        launchDate=None, launchWindow=None, launchPrecision=None, target="Lunar south pole region (planned)",
        coordinateKind=None, payloadCount=None,
        note="Cancelled after Masten's July 2022 bankruptcy; assets acquired by Astrobotic. Had been awarded April 2020 for a south-pole delivery.",
        sources="NASA CLPS announcements. Curated snapshot, not a live manifest.",
        sourceUrls=["https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services"],
        unconfirmed=True, lastReviewed=REVIEW),
    dict(name="Draper Farside (CP-12)", provider="Draper Laboratory (lander by ispace-U.S.)", vehicle="APEX 1.0",
        status="cancelled", landingUTC=None, lat=None, lonEast=None, siteSlug=None, sunAtTouchdown=None,
        launchDate=None, launchWindow=None, launchPrecision=None, target="Schrödinger basin",
        coordinateKind=None, payloadCount=None,
        note="Cancelled by mutual agreement of NASA and Draper in July 2026 after lander development delays. Would have been the first U.S. far-side landing, delivering the Farside Seismic Suite.",
        sources="SpaceNews and NASA statements. Curated snapshot, not a live manifest.",
        sourceUrls=["https://spacenews.com/nasa-terminates-draper-lunar-lander-mission"],
        lastReviewed=REVIEW),
    dict(name="Peregrine Mission One", provider="Astrobotic", vehicle="Peregrine",
        status="partially-flown", landingUTC=None, lat=None, lonEast=None, siteSlug=None, sunAtTouchdown=None,
        launchDate="2024-01-08", launchWindow=None, launchPrecision="day",
        target="Sinus Viscositatis (planned)", coordinateKind=None, payloadCount=20,
        note="Launched 8 January 2024 on Vulcan's maiden flight; a propellant leak prevented lunar insertion and the spacecraft reentered Earth's atmosphere 18 January 2024. No landing attempt.",
        sources="Astrobotic launch packet and NASA updates. Curated snapshot, not a live manifest.",
        sourceUrls=["https://en.wikipedia.org/wiki/Peregrine_Mission_One"],
        lastReviewed=REVIEW),
]


# Itemized payload manifests (see clps_payloads.py for sourcing).
from clps_payloads import PAYLOADS
for m in missions:
    if m["name"] in PAYLOADS:
        m["payloads"] = PAYLOADS[m["name"]]

def sort_key(m):
    d = m.get("launchDate") or m.get("landingUTC") or ""
    return (d if d else "9999") + m["name"]


missions.sort(key=sort_key)
P.write_text(json.dumps(missions, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {len(missions)} missions")
