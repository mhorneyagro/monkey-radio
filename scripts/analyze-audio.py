#!/usr/bin/env python3
"""Analyze audio files with Essentia (genre, mood, BPM, key).

Requires:
  pip install essentia essentia-tensorflow

Downloads ML models on first run to data/models/essentia/.
"""

from __future__ import annotations

import os

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GLOG_minloglevel", "2")

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

try:
    from essentia.standard import (
        KeyExtractor,
        MonoLoader,
        RhythmExtractor2013,
        TensorflowPredict2D,
        TensorflowPredictEffnetDiscogs,
    )
except ImportError:
    print(
        "Missing dependencies. Install with:\n"
        "  pip install essentia essentia-tensorflow",
        file=sys.stderr,
    )
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT / "data/temp/youtube-import"
DEFAULT_OUTPUT = REPO_ROOT / "data/temp/youtube-import/analysis.json"
MODEL_DIR = REPO_ROOT / "data/models/essentia"

MODELS = {
    "discogs-effnet-bs64-1.pb": (
        "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
    ),
    "genre_discogs400-discogs-effnet-1.pb": (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb"
    ),
    "genre_discogs400-discogs-effnet-1.json": (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json"
    ),
    "mtg_jamendo_genre-discogs-effnet-1.pb": (
        "https://essentia.upf.edu/models/classification-heads/mtg_jamendo_genre/mtg_jamendo_genre-discogs-effnet-1.pb"
    ),
    "mtg_jamendo_genre-discogs-effnet-1.json": (
        "https://essentia.upf.edu/models/classification-heads/mtg_jamendo_genre/mtg_jamendo_genre-discogs-effnet-1.json"
    ),
    "mtg_jamendo_moodtheme-discogs-effnet-1.pb": (
        "https://essentia.upf.edu/models/classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.pb"
    ),
    "mtg_jamendo_moodtheme-discogs-effnet-1.json": (
        "https://essentia.upf.edu/models/classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.json"
    ),
}

MONKEY_RADIO_GENRES = ("jazz", "synthwave", "lofi", "ambient", "funk", "rock")

JAMENDO_TO_MONKEY = {
    "jazz": {
        "jazz",
        "jazzfusion",
        "acidjazz",
        "bossanova",
        "swing",
        "fusion",
        "improvisation",
        "blues",
        "soul",
        "rnb",
        "latin",
    },
    "synthwave": {
        "synthpop",
        "newwave",
        "electronic",
        "electronica",
        "electropop",
        "darkwave",
        "eurodance",
        "techno",
        "trance",
        "80s",
        "edm",
        "house",
        "deephouse",
        "dance",
        "club",
    },
    "lofi": {
        "chillout",
        "downtempo",
        "triphop",
        "lounge",
        "hiphop",
        "easylistening",
        "instrumentalpop",
        "idm",
        "dub",
    },
    "ambient": {
        "ambient",
        "atmospheric",
        "darkambient",
        "newage",
        "minimal",
        "experimental",
        "soundtrack",
        "orchestral",
        "classical",
        "medieval",
        "world",
        "worldfusion",
        "ethno",
    },
    "funk": {"funk", "groove", "disco", "soul", "rnb"},
    "rock": {
        "rock",
        "alternativerock",
        "classicrock",
        "hardrock",
        "indie",
        "poprock",
        "postrock",
        "progressive",
        "psychedelic",
        "punkrock",
        "rocknroll",
        "instrumentalrock",
        "grunge",
        "metal",
        "hard",
        "bluesrock",
        "pop",
        "popfolk",
    },
}

DISCOGS_KEYWORDS = {
    "jazz": ("jazz", "blues", "soul", "funk", "r&b", "swing", "bossa"),
    "synthwave": ("synth", "electronic", "new wave", "disco", "techno", "house"),
    "lofi": ("hip hop", "trip hop", "downtempo", "chill", "lo-fi", "lo fi"),
    "ambient": ("ambient", "new age", "atmospheric", "drone", "soundtrack"),
    "funk": ("funk", "soul", "disco", "groove"),
    "rock": ("rock", "indie", "alternative", "metal", "punk", "grunge"),
}


def download_models() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS.items():
        dest = MODEL_DIR / name
        if dest.exists():
            continue
        print(f"Downloading {name}...")
        urllib.request.urlretrieve(url, dest)
        print(f"  saved to {dest}")


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def top_predictions(
    classes: list[str],
    predictions: np.ndarray,
    limit: int = 5,
    threshold: float = 0.05,
) -> list[dict[str, float | str]]:
    scores = np.array(predictions).mean(axis=0)
    indices = np.argsort(scores)[::-1]
    results: list[dict[str, float | str]] = []
    for index in indices[:limit]:
        score = float(scores[index])
        if score < threshold:
            continue
        results.append({"label": classes[index], "score": round(score, 4)})
    return results


def map_to_monkey_radio(jamendo_genres: list[dict[str, float | str]]) -> dict:
    totals = {genre: 0.0 for genre in MONKEY_RADIO_GENRES}
    for entry in jamendo_genres:
        label = str(entry["label"])
        score = float(entry["score"])
        for monkey_genre, jamendo_tags in JAMENDO_TO_MONKEY.items():
            if label in jamendo_tags:
                totals[monkey_genre] += score

    ranked = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    best_genre, best_score = ranked[0]
    return {
        "genre": best_genre if best_score > 0 else "ambient",
        "confidence": round(best_score, 4),
        "scores": {genre: round(score, 4) for genre, score in ranked if score > 0},
    }


def map_discogs_genres(discogs_genres: list[dict[str, float | str]]) -> dict:
    totals = {genre: 0.0 for genre in MONKEY_RADIO_GENRES}
    for entry in discogs_genres:
        label = str(entry["label"]).lower()
        score = float(entry["score"])
        for monkey_genre, keywords in DISCOGS_KEYWORDS.items():
            if any(keyword in label for keyword in keywords):
                totals[monkey_genre] += score

    ranked = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    best_genre, best_score = ranked[0]
    return {
        "genre": best_genre if best_score > 0 else None,
        "confidence": round(best_score, 4),
        "scores": {genre: round(score, 4) for genre, score in ranked if score > 0},
    }


def extract_youtube_id(filename: str) -> str | None:
    match = re.search(r"\[([A-Za-z0-9_-]{11})\]", filename)
    return match.group(1) if match else None


class Analyzer:
    def __init__(self) -> None:
        download_models()

        self.embedding_model = TensorflowPredictEffnetDiscogs(
            graphFilename=str(MODEL_DIR / "discogs-effnet-bs64-1.pb"),
            output="PartitionedCall:1",
        )
        self.jamendo_genre_model = TensorflowPredict2D(
            graphFilename=str(MODEL_DIR / "mtg_jamendo_genre-discogs-effnet-1.pb")
        )
        self.jamendo_mood_model = TensorflowPredict2D(
            graphFilename=str(MODEL_DIR / "mtg_jamendo_moodtheme-discogs-effnet-1.pb")
        )
        self.discogs_genre_model = TensorflowPredict2D(
            graphFilename=str(MODEL_DIR / "genre_discogs400-discogs-effnet-1.pb"),
            input="serving_default_model_Placeholder",
            output="PartitionedCall:0",
        )

        self.jamendo_genre_classes = load_json(
            MODEL_DIR / "mtg_jamendo_genre-discogs-effnet-1.json"
        )["classes"]
        self.jamendo_mood_classes = load_json(
            MODEL_DIR / "mtg_jamendo_moodtheme-discogs-effnet-1.json"
        )["classes"]
        self.discogs_genre_classes = load_json(
            MODEL_DIR / "genre_discogs400-discogs-effnet-1.json"
        )["classes"]

    def analyze_file(self, path: Path) -> dict:
        print(f"Analyzing {path.name}...")

        audio16 = MonoLoader(filename=str(path), sampleRate=16000, resampleQuality=4)()
        audio44 = MonoLoader(filename=str(path), sampleRate=44100)()
        duration_sec = round(len(audio44) / 44100, 2)

        embeddings = self.embedding_model(audio16)

        jamendo_genres = top_predictions(
            self.jamendo_genre_classes,
            self.jamendo_genre_model(embeddings),
            threshold=0.05,
        )
        moods = top_predictions(
            self.jamendo_mood_classes,
            self.jamendo_mood_model(embeddings),
            threshold=0.03,
            limit=8,
        )
        discogs_genres_raw = top_predictions(
            self.discogs_genre_classes,
            self.discogs_genre_model(embeddings),
            threshold=0.08,
            limit=8,
        )
        discogs_genres = [
            {
                "label": entry["label"].replace("---", " › "),
                "score": entry["score"],
            }
            for entry in discogs_genres_raw
        ]

        bpm, _, _, _, _ = RhythmExtractor2013(method="multifeature")(audio44)
        key, scale, key_strength = KeyExtractor()(audio44)
        monkey_radio = map_to_monkey_radio(jamendo_genres)
        discogs_mapping = map_discogs_genres(
            [{"label": entry["label"], "score": entry["score"]} for entry in discogs_genres_raw]
        )

        return {
            "file": path.name,
            "youtubeId": extract_youtube_id(path.name),
            "durationSec": duration_sec,
            "bpm": round(float(bpm), 1),
            "key": f"{key} {scale}",
            "keyStrength": round(float(key_strength), 3),
            "jamendoGenres": jamendo_genres,
            "moods": moods,
            "discogsGenres": discogs_genres,
            "monkeyRadioGenre": monkey_radio,
            "discogsMappedGenre": discogs_mapping,
            "suggestedGenre": monkey_radio["genre"],
        }


def collect_audio_files(input_dir: Path) -> list[Path]:
    extensions = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
    return sorted(
        path
        for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in extensions
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze audio files with Essentia (genre, mood, BPM, key).",
    )
    parser.add_argument(
        "input_dir",
        nargs="?",
        default=str(DEFAULT_INPUT),
        help=f"Directory containing audio files (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_path = Path(args.output).resolve()

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        sys.exit(1)

    files = collect_audio_files(input_dir)
    if not files:
        print(f"No audio files found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    analyzer = Analyzer()
    tracks = [analyzer.analyze_file(path) for path in files]

    payload = {
        "analyzedAt": __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat(),
        "inputDir": str(input_dir),
        "trackCount": len(tracks),
        "tracks": tracks,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)

    print(f"\nWrote analysis for {len(tracks)} track(s) to {output_path}")


if __name__ == "__main__":
    main()
