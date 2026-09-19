#!/usr/bin/env python3
"""
Take the useful part of the Sonniss GDC bundle into the sound library.

The bundle (Sonniss "#GameAudioGDC", royalty-free, no attribution required) is
122 folders of samples from commercial libraries -- 347 WAV files, 7.5 GB, most
of it recorded for films and for other games entirely. Casino cards, barbershop
foley, five packs of crowd walla, dinosaurs.

**`SHORTLIST` below is the answer to "what of it belongs in this game".** Thirty
folders, grouped by what the sound would do in a match: the interface, the
mechanisms a building is made of, impacts and weapons, alarms, and the
Verdigris. Everything else was listened past and left where it is; `REJECTED`
says why, briefly, so the question does not have to be asked again when the
next bundle arrives.

What lands in art/sfx-library is not what came out of the bundle:

  - **Named.** A library files a sound as `DSGNImpt_Metal Hit Thud Thump Low
    Ring Geofon 1_The Noisery_Moaning Metal.wav`; here it is `metal-hit-thud-
    low-ring.ogg`. The name is what a person reads in the sound effects tool,
    so every one of them is written out below rather than mangled out of the
    original by a rule.
  - **Cut.** Half of what is useful arrives as one file of twenty sword impacts
    with two seconds of silence between them -- a source, not a sound. `CUT`
    finds the gaps and writes each hit on its own, up to eight of them.
  - **Ogg Vorbis at 48 kHz**, from 96 kHz/24-bit WAV. The library is read by a
    browser and the sounds are two seconds long: the difference is inaudible
    and the files are a twentieth of the size.

Nothing is normalised or trimmed at the head. Level is a property of the
assignment, not of the file, and the tool has a volume per sound.

Not imported: the industrial beds -- factory halls, reactor loops, deep hums,
ash wind rattling metal. They are the right material and there is nowhere for
them to go: the sound engine plays one-shots, and an ambience layer that loops
them does not exist yet. `BEDS` lists the ones to come back for.

    python scripts/sfx/import_soniss.py [--force] [path to the bundle]

Needs ffmpeg on PATH. Idempotent: a sound already in the library is left alone
unless --force, so re-running after adding an entry writes only what is new.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LIBRARY = REPO / "art" / "sfx-library"
DEFAULT_SOURCE = Path.home() / "Downloads" / "soniss"

# 48 kHz because nothing here is heard above it, and quality 4 (~128 kbps)
# because a metal impact at 2 kbps more is the same metal impact.
RATE = "48000"
QUALITY = "4"

# Splitting. A gap this quiet for this long is where one take ends and the next
# begins; the padding keeps the attack and the tail of each.
SILENCE_DB = "-45dB"
SILENCE_SECONDS = "0.35"
PAD_BEFORE = 0.15
PAD_AFTER = 0.60
MIN_PIECE = 0.25
# Eight variations is already more than the game picks between. A take of
# twenty is a source; importing all of it would bury the library.
MAX_PIECES = 8

ONE = "one"
CUT = "cut"

# Each entry: the library sub-folder, the folder in the bundle, and what to
# take from it -- the file, what to do with it, and what to call it here.
# A clip is (start, end) in seconds.
SHORTLIST: list[tuple[str, str, list[tuple[str, object, str]]]] = [
    # -- the interface: clicks, refusals, the sound of an order being taken ---
    ("interface", "Cinematic Sound Design - Interface & Infographics", [
        ("Interface Accept Glassy Snap.wav", ONE, "accept-glassy-snap"),
        ("Interface Percussion Snap.wav", ONE, "percussion-snap"),
        ("Interface Pop High Short.wav", ONE, "pop-high-short"),
    ]),
    ("interface", "Cinematic Sound Design - System & UI Feedback Elements", [
        # The one this game most lacks: an order refused.
        ("Interface Deny Low Fat Dark.wav", ONE, "deny-low-dark"),
        ("Interface Sci-Fi Ping Down.wav", ONE, "ping-down"),
        ("Interface Arp Reveal Down Long.wav", ONE, "arp-reveal-down"),
    ]),
    ("interface", "Cinematic Sound Design - UI Interaction Elements", [
        ("Accept Boing Crunch.wav", ONE, "accept-crunch"),
        ("Deny Muted.wav", ONE, "deny-muted"),
        # Alloy dropped off at a Nexus.
        ("Ting Coins.wav", ONE, "coins-ting"),
    ]),
    ("interface", "Cinematic Sound Design - User Interface", [
        # The rest of this pack is bright and cheerful, which the Ashworks
        # is not.
        ("Readout Thin Long.wav", ONE, "readout-thin"),
    ]),
    ("interface", "The Noisery - Rich Glitch", [
        ("UIGlitch_Designed_Glitch_Corrupted_Data Error_The Noisery_Rich Glitch_06.wav", CUT, "glitch-data-error"),
        # Twenty-four unbroken seconds of it; four is an interface sound.
        ("UIGlitch_User interface_Glitch_High_Electronic_The Noisery_Rich Glitch_05.wav", (0.0, 4.0), "glitch-electronic"),
    ]),

    # -- mechanisms: what a building is made of ------------------------------
    ("mechanism", "Epic Stock Media - HD Lock And Mechanism Sound Design Kit", [
        ("MACHMech_Mechanism Counting Machine Interact Loose Container Short 01_ESM_HDLM.wav", ONE, "counting-machine"),
        # A building finishing: clamps locking.
        ("MECHLtch_Click Deep Mechanism Latch Button Nearfield Thunk 02_ESM_HDLM.wav", ONE, "latch-thunk-deep"),
        ("MECHMisc_Tool Tape Measure Pull Retract Spring Slide Spin Long 07_ESM_HDLM.wav", ONE, "tape-measure-retract"),
        ("METLTonl_Item Spring Wire Impact Flick Top Clatter Light Tap Roll Handling Short 01_ESM_HDLM.wav", CUT, "spring-wire-clatter"),
    ]),
    ("mechanism", "Epic Stock Media - Tower Defense Game", [
        # Servo whine and a dark thump: a Directorate structure unfolding.
        ("ROBTMvmt_Tower Deploy Hitech Robot Motor Dark Thump Servo Whine 04_ESM_TDG.wav", ONE, "tower-deploy-servo"),
        ("DSGNStngr_Action Deploy Units Sword Slice Special Move Layered Swish 04_ESM_TDG.wav", ONE, "deploy-units-swish"),
    ]),
    ("mechanism", "344 Audio - Antique Small Metals", [
        ("METLMvmt_  Antique Measuring Tape_344 Audio_Antique Small Metals.wav", ONE, "measuring-tape"),
        ("METLMvmt_  Opening Lid Of Antique Blowtorch_344 Audio_Antique Small Metals.wav", ONE, "blowtorch-lid"),
        ("METLMvmt_  Tinkering Antique Lock_344 Audio_Antique Small Metals.wav", ONE, "lock-tinkering"),
    ]),
    ("mechanism", "344 Audio - Air Designed", [
        # The drop that lands a Directorate building. See UNIVERSE.md.
        ("AEROJet_Blast Off Clean_344 Audio_Air Designed.wav", ONE, "jet-blast-off"),
    ]),
    ("mechanism", "InMotionAudio - Arc", [
        ("ELECArc_ArcDesign15_InMotionAudio_Arc.wav", ONE, "electric-arc"),
        ("ELECArc_ArcPowerUpDesign04_InMotionAudio_Arc.wav", ONE, "electric-arc-power-up"),
        ("ELECBuzz_Buzz27_InMotionAudio_Arc.wav", ONE, "electric-buzz"),
    ]),

    # -- impacts, weapons, the end of things ---------------------------------
    ("impact", "The Noisery - Moaning Metal", [
        ("DSGNImpt_Metal Hit Thud Thump Low Ring Geofon 1_The Noisery_Moaning Metal.wav", ONE, "metal-hit-thud-low-ring"),
        ("DSGNTonl_Metal Scrape Low Tonal LFE 4_The Noisery_Moaning Metal.wav", ONE, "metal-scrape-low"),
        # One long screech, which a structure under fire only needs the head of.
        ("DSGNTonl_Designed Metal Bowed Screech Tonal Reverb 7_The Noisery_Moaning Metal.wav", (0.0, 8.0), "metal-bowed-screech"),
    ]),
    ("impact", "Cinematic Sound Design - Colossal Impacts", [
        ("Impact Cut Sweep.wav", ONE, "impact-cut-sweep"),
        ("Woosh Debris.wav", ONE, "debris-whoosh"),
        ("Transition Frantic Shaker Snap.wav", ONE, "shaker-snap"),
    ]),
    ("impact", "Cinematic Sound Design - Ultra Transitions & Impacts", [
        ("Impact Hit Rapid Chord Reverb.wav", ONE, "impact-chord-reverb"),
        ("Transition Braam Slow Dark Creepy.wav", ONE, "braam-slow-dark"),
        ("Woosh Sweep Slide Infographics Basic.wav", ONE, "sweep-slide-short"),
    ]),
    ("impact", "Federico Soler - Effective Trailer Booms Vol. 2", [
        # One boom each, with six seconds of room afterwards that CUT drops.
        ("EffectiveTrailer_Booms_Vol2_011.wav", CUT, "trailer-boom-a"),
        ("EffectiveTrailer_Booms_Vol2_075.wav", CUT, "trailer-boom-b"),
        ("EffectiveTrailer_Booms_Vol2_214.wav", CUT, "trailer-boom-c"),
    ]),
    ("impact", "Epic Stock Media - Elemental Mutation Whooshes and Impacts", [
        ("ELECMisc_Impact Electric Tonal Deep Movement Motion Hiss Glitch 01_ESM_EMWI.wav", ONE, "electric-impact-hiss"),
        ("FIREWhsh_Whoosh Fire Deep Growl Monster Saturated Crisp 03_ESM_EMWI.wav", ONE, "fire-whoosh-growl"),
        ("GLASMvmt_Whoosh Glass Crystal Fragments Sharp Shards Dry 05_ESM_EMWI.wav", ONE, "glass-shards-whoosh"),
        ("WATRImpt_Impact Water Deep Submerge Bubble Drown Ship Hit 05_ESM_EMWI.wav", ONE, "water-impact-deep"),
    ]),
    ("impact", "David Dumais Audio - Melee Weapons Sound Effects Pack 2", [
        ("METLFric_SWING SCRAPE Swift Melee Weapon Swing With A Long Blade 14_DDUMAIS_MWP2.wav", ONE, "blade-swing-scrape"),
        ("METLImpt_METAL SWING HIT Weapon Swing To Metallic Body Impact And Resonant Tail 01_DDUMAIS_MWP2.wav", ONE, "metal-swing-hit-body"),
        ("WEAPWhip_WHIP Snap Crack 05_DDUMAIS_MWP2.wav", ONE, "whip-snap-crack"),
        # Twenty variations in one file. The closest thing in the bundle to a
        # weapon hitting a machine, and the bundle has no firearms at all.
        ("SWSH_SWING IMPACTS Quick Heavy Weapon Swing To Thud Impact Var 01_DDUMAIS_MWP2.wav", CUT, "heavy-swing-thud"),
    ]),
    ("impact", "344 Audio - Historical Weapons Vol. 2", [
        ("WEAPBlnt_Spear And Stick Impact, Wooden MKH 2_344 Audio_Medieval Weapons Vol 2.wav", CUT, "wood-shaft-impact"),
        ("WEAPSwrd_Sword Slide Cuts, Metallic, Impact CM4 2_344 Audio_Medieval Weapons Vol 2.wav", CUT, "metal-blade-cut"),
        ("WEAPArmr_Metal Shield Spin On Floor, Buckler MKH_344 Audio_Medieval Weapons Vol 2.wav", CUT, "metal-plate-spin"),
    ]),
    ("impact", "Ivo Vicic - Fireworks FX", [
        # A dense run of them, with no gaps to cut on: six seconds of barrage.
        ("13 Fireworks_powerful explosions_multiples in a row_near.wav", (0.85, 7.0), "explosions-near"),
    ]),
    ("impact", "InMotionAudio - Sinister Textures 4", [
        ("DSGNErie_NoiseBoxHit_10_InMotionAudio_SinisterTextures4.wav", CUT, "noise-box-hit-a"),
        ("DSGNErie_NoiseBoxHit_36_InMotionAudio_SinisterTextures4.wav", CUT, "noise-box-hit-b"),
    ]),
    ("impact", "InMotionAudio - Sinister Textures 5", [
        ("GOREMisc_Cladding_NailScratch19_InMotionAudio_SinisterTextures5.wav", ONE, "cladding-nail-scratch"),
        ("GOREMisc_Cladding_Scratch06_InMotionAudio_SinisterTextures5.wav", ONE, "cladding-scratch"),
        ("GOREMisc_Concrete_MetalPipe02_InMotionAudio_SinisterTextures5.wav", ONE, "concrete-metal-pipe"),
    ]),
    ("impact", "Epic Stock Media - HD Game Materials", [
        ("METLImpt_Metal Old File Impact Tap Against Tire Iron Metallic Hit 01_ESM_HDGM.wav", ONE, "metal-file-tap"),
        ("ICEFric_Dry Ice High Metal Squeal Groan Bright Squeak Dissonant Short 13_ESM_HDGM.wav", ONE, "metal-squeal-groan"),
        ("ICEFric_Dry Ice Squeak Metal Animal Mouse Imitation Short 07_ESM_HDGM.wav", ONE, "metal-squeak-short"),
        ("WOODFric_Wood Shaker Microphone Head Roll Table Alternate Grainy 05_ESM_HDGM.wav", ONE, "wood-shaker-roll"),
    ]),
    ("impact", "Epic Stock Media - Tower Defense Game", [
        # Wet, and short: something organic coming apart.
        ("WOODImpt_Hit Blood Spill Splat Wood Impact Light Hit Squelch Small Thump 03_ESM_TDG.wav", ONE, "wet-splat-thump"),
    ]),

    # -- alarms and the Directorate's own voice ------------------------------
    ("alarm", "Federico Soler - Effective Trailer Alarms Vol. 2", [
        # Thirty-second loops; six seconds is a warning.
        ("EffectiveTrailer_Alarms_Vol2_QuarterNotes_013.wav", (0.0, 6.0), "alarm-quarter-notes"),
        ("EffectiveTrailer_Alarms_Vol2_HalfNotes_003.wav", (0.0, 6.0), "alarm-half-notes"),
    ]),
    ("alarm", "Epic Stock Media - Fake Advertisements and Radio Sound Effects Audio Construction Kit", [
        ("VOXMale_Voice Wet Male Emergency Broadcast Announcement Dry War 01_ESM_FA.wav", ONE, "emergency-broadcast"),
        ("COMStatic_Radio Ham Loop Static Hum Active Powered On Garbled Noise 01_ESM_FA.wav", (0.0, 8.0), "radio-static-garbled"),
    ]),

    # -- the Verdigris -------------------------------------------------------
    ("creature", "SoundBits - Vox Bestiae - Source Elements", [
        # The hive, in four files.
        ("CREAInsc_Insectoid Creature Tremble Attack Long 1_SNDBTS_VB-SE.wav", ONE, "insectoid-attack"),
        ("CREAEthr_Ethereal Entity Grim Pain Long 4_SNDBTS_VB-SE.wav", ONE, "grim-pain-long"),
        ("CREAHmn_Violent Humanoid Creature Exhale Short 4_SNDBTS_VB-SE.wav", ONE, "violent-exhale"),
        ("CREAAqua_Aquatic Creature Gurgling 2_SNDBTS_VB-SE.wav", ONE, "wet-gurgling"),
    ]),
    ("creature", "Epic Stock Media - Humanoid Creatures Vol 4 - Monstrous and Undead Creature Vocalization Sound Sets", [
        ("CREAHmn_Designed Orc Male Attack Long Heavy Hit Charged Up 03_ESM_HC4.wav", ONE, "creature-attack-charged"),
        ("CREAMnstr_Designed Sea Beast Creature Pain Intense Yell Long 04_ESM_HC4.wav", ONE, "creature-pain-yell"),
        ("HMNBrth_Construction Kit Male Screeching Breath Inhale Weak Squeal 05_ESM_HC4.wav", ONE, "screeching-breath"),
        ("VOXReac_Construction Kit Male Flutter Death Vocal Stuttered Long 05_ESM_HC4.wav", ONE, "flutter-death-vocal"),
    ]),
    ("creature", "InMotionAudio - The Death Whistle", [
        ("CREAEthr_Aztec Death Whistle DryPitch12_IMA_Death Whistle Samples.wav", ONE, "death-whistle-dry"),
        ("CREAEthr_Aztec Death Whistle Distortion_02_IMA_Death Whistle Samples.wav", ONE, "death-whistle-distorted"),
        ("CREAEthr_Aztec Death Whistle Drone_05_IMA_Death Whistle Samples.wav", (0.0, 8.0), "death-whistle-drone"),
    ]),
    ("creature", "Epic Stock Media - Halloween Game - Haunted House and Horror Audio Scare Kit", [
        ("CREABeast_Creature Werewolf Growl Menacing Monstrous 06_ESM_HALG.wav", ONE, "beast-growl-menacing"),
        ("GORESplt_Gore Designed Transient Heavy Impact Smash 01_ESM_HALG.wav", ONE, "gore-impact-smash"),
        ("DSGNEthr_Jumpscare Vocal Aggressive Whisper Harsh Distortion 02_ESM_HALG.wav", ONE, "aggressive-whisper"),
        ("UIAlert_Alert Designed Transition Swell Creature Strange Alien Layered 01_ESM_HALG.wav", ONE, "alien-alert-swell"),
    ]),
    ("creature", "Alexander Kopeikin - Emotion and Magic", [
        # Not magic here: a brood waking up, and something growing.
        ("magic, action gesture, evil presence, onslaught-004.wav", (0.0, 12.0), "presence-onslaught"),
        ("magic, energy flow, astonishment-001.wav", (0.0, 12.0), "energy-flow-swell"),
    ]),
]

# Right for this game, with nowhere to play them until the sound engine has a
# looping ambience layer. Do not delete: this is the shortlist for that day.
BEDS = [
    "Victor Ermakov - Industrial Ambiences - Ship Repair Factory",  # factory hall, crane cab
    "Epic Stock Media - Strange Game Ambient Loops 3",              # factory loop, reactor loop
    "Cinematic Sound Design - Sci-Fi Drones",                       # dark industrial ambience
    "Jake Fielding - Fridge Hums Vol.2",                            # deep electrical hum
    "Ivo Vicic - Campfire - Bonfire FX",                            # wreckage burning
    "The Noisery - City Rain",                                      # wind, strong, rattling metal
    "344 Audio - Extreme Winds Vol. 1",                             # and a metal box dragged
    "344 Audio - East Coast America Vol. 1",                        # electrical hum, coil pickup
]

# The other ninety-odd folders, and the reason. Written down so the next bundle
# can be sorted in an afternoon rather than from scratch.
REJECTED = {
    "voices and crowds in the wrong register": [
        "anime fight voices", "AAA character voices", "shooter announcer", "police radio",
        "wallas (British, Spanish, Nigerian, South African)", "bars", "pools", "stations",
    ],
    "domestic or period foley with no place in the Ashworks": [
        "books", "clocks", "luggage", "telephone", "typewriter", "barbershop", "casino",
        "Christmas", "board games", "paper", "velcro", "laundry", "saxophone", "music boxes",
    ],
    "vehicles": ["cars", "motorcycles", "trains", "trams", "pass-bys", "toy quadcopter"],
    "nature with no industrial edge": [
        "Norway", "parks", "storms", "rain", "church bells", "distant fireworks",
    ],
    "wrong tone": [
        "cartoon", "anime game", "fantasy", "kalimba interfaces", "dinosaurs", "dogs", "ice",
        "horror ambience beds", "trailer bass drops and horn braams (music, not effects)",
    ],
}


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("ffmpeg is not on PATH", file=sys.stderr)
        return 1

    force = "--force" in sys.argv[1:]
    args = [a for a in sys.argv[1:] if a != "--force"]
    source = Path(args[0]) if args else DEFAULT_SOURCE
    if not source.is_dir():
        print(f"no bundle at {source}", file=sys.stderr)
        return 1

    written = skipped = 0
    for family, folder, takes in SHORTLIST:
        out = LIBRARY / f"soniss_{family}"
        out.mkdir(parents=True, exist_ok=True)
        licence(out)

        for filename, what, name in takes:
            src = source / folder / filename
            if not src.is_file():
                print(f"  missing: {folder}/{filename}", file=sys.stderr)
                continue

            if what == CUT:
                pieces = segments(src)
                for i, (start, end) in enumerate(pieces, start=1):
                    # A take that turned out to hold one sound keeps its name;
                    # only a real split is numbered.
                    stem = name if len(pieces) == 1 else f"{name}-{i:02d}"
                    written, skipped = encode(
                        src, out / f"{stem}.ogg", start, end, force, written, skipped
                    )
            elif isinstance(what, tuple):
                written, skipped = encode(
                    src, out / f"{name}.ogg", what[0], what[1], force, written, skipped
                )
            else:
                written, skipped = encode(src, out / f"{name}.ogg", None, None, force, written, skipped)

    print(f"\n{written} written, {skipped} already there -> {LIBRARY}")
    return 0


def segments(src: Path) -> list[tuple[float, float]]:
    """Where the sounds are in a take that holds several of them.

    Read off the gaps rather than the sounds: silence is what a library leaves
    between variations, and it is the one thing that can be measured without
    knowing what the sound is.
    """
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(src),
         "-af", f"silencedetect=noise={SILENCE_DB}:d={SILENCE_SECONDS}", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    ).stderr

    gaps: list[tuple[float, float]] = []
    start: float | None = None
    for line in out.splitlines():
        if (m := re.search(r"silence_start: ([\d.]+)", line)):
            start = float(m.group(1))
        elif (m := re.search(r"silence_end: ([\d.]+)", line)) and start is not None:
            gaps.append((start, float(m.group(1))))
            start = None

    total = duration(src)
    if start is not None:
        gaps.append((start, total))

    pieces: list[tuple[float, float]] = []
    at = 0.0
    for gap_start, gap_end in gaps:
        if gap_start - at >= MIN_PIECE:
            pieces.append((max(0.0, at - PAD_BEFORE), min(total, gap_start + PAD_AFTER)))
        at = gap_end
    if total - at >= MIN_PIECE:
        pieces.append((max(0.0, at - PAD_BEFORE), total))

    return pieces[:MAX_PIECES] if pieces else [(0.0, total)]


def duration(src: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def encode(
    src: Path,
    dst: Path,
    start: float | None,
    end: float | None,
    force: bool,
    written: int,
    skipped: int,
) -> tuple[int, int]:
    if dst.exists() and not force:
        return written, skipped + 1

    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src)]
    if start is not None:
        command += ["-ss", f"{start:.3f}"]
    if end is not None:
        command += ["-to", f"{end:.3f}"]
    # No metadata: the bundle's tags name a library nobody will go looking for
    # from inside the game, and they are the only thing that would make two
    # runs of this script differ.
    command += ["-ar", RATE, "-map_metadata", "-1", "-c:a", "libvorbis", "-q:a", QUALITY, str(dst)]
    subprocess.run(command, check=True)
    print(f"  {dst.relative_to(LIBRARY)}")
    return written + 1, skipped


def licence(folder: Path) -> None:
    """The terms, beside the sounds, as every pack in the library has."""
    path = folder / "License.txt"
    if path.exists():
        return
    path.write_text(
        "Sonniss #GameAudioGDC Bundle (GDC 2026).\n"
        "Royalty-free: use personally or commercially, no attribution required.\n"
        "https://sonniss.com/gameaudiogdc\n\n"
        "Converted to 48 kHz Ogg Vorbis, and long takes cut into their\n"
        "individual sounds, by scripts/sfx/import_soniss.py.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
