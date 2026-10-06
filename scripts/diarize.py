#!/usr/bin/env python3
"""
Speaker Diarization Worker Script using pyannote/speaker-diarization-community-1.

Produces anonymous speaker segments (SPEAKER_00, SPEAKER_01, etc.) with start and end timestamps.
Never infers or assigns real person identities.
"""

import argparse
import json
import os
import sys

def check_availability():
    try:
        import torch
        import pyannote.audio
        device = "cuda" if torch.cuda.is_available() else "cpu"
        return {
            "available": True,
            "pyannoteVersion": getattr(pyannote.audio, "__version__", "unknown"),
            "torchVersion": getattr(torch, "__version__", "unknown"),
            "device": device
        }
    except ImportError as e:
        return {
            "available": False,
            "reason": str(e)
        }
    except Exception as e:
        return {
            "available": False,
            "reason": f"Unexpected error checking pyannote: {e}"
        }

def run_diarization(audio_path, hf_token=None, model_name=None, device_name=None):
    if not os.path.exists(audio_path):
        return {"error": f"Audio file not found: {audio_path}", "code": "FILE_NOT_FOUND"}

    token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    model = model_name or os.environ.get("PYANNOTE_MODEL") or "pyannote/speaker-diarization-community-1"

    try:
        import torch
        from pyannote.audio import Pipeline
    except ImportError as e:
        return {
            "error": f"pyannote.audio or torch is not installed: {e}. Install via: pip install pyannote.audio torch",
            "code": "NOT_INSTALLED"
        }

    if not token and "community" in model.lower():
        return {
            "error": "Hugging Face token is required for pyannote/speaker-diarization-community-1. Set HF_TOKEN environment variable or pass --hf-token.",
            "code": "AUTH_REQUIRED"
        }

    try:
        # Support both modern and legacy token argument names in pyannote Pipeline
        try:
            pipeline = Pipeline.from_pretrained(model, token=token)
        except TypeError:
            pipeline = Pipeline.from_pretrained(model, use_auth_token=token)

        if pipeline is None:
            return {
                "error": f"Failed to load pipeline '{model}'. Check access permissions on Hugging Face.",
                "code": "PIPELINE_LOAD_FAILED"
            }

        # Device selection: respect explicit flag or auto-detect
        if device_name:
            target_device = torch.device(device_name)
        elif torch.cuda.is_available():
            target_device = torch.device("cuda")
        else:
            target_device = torch.device("cpu")

        try:
            pipeline.to(target_device)
        except Exception as dev_err:
            # Fallback to CPU if CUDA fails
            sys.stderr.write(f"Warning: Failed to move pipeline to {target_device}: {dev_err}. Falling back to CPU.\n")
            pipeline.to(torch.device("cpu"))

        # Run inference
        diarization = pipeline(audio_path)

        segments = []
        distinct_speakers = set()

        # Iterate over speaker turns
        # In pyannote.audio, itertracks(yield_label=True) gives (turn, track_id, speaker_label)
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            distinct_speakers.add(str(speaker))
            segments.append({
                "speakerId": str(speaker),
                "start": round(float(turn.start), 3),
                "end": round(float(turn.end), 3),
                "confidence": None
            })

        # Sort segments chronologically
        segments.sort(key=lambda s: s["start"])

        return {
            "speakerCount": len(distinct_speakers),
            "segments": segments
        }
    except Exception as e:
        return {
            "error": f"Diarization inference failed: {str(e)}",
            "code": "INFERENCE_ERROR"
        }

def main():
    parser = argparse.ArgumentParser(description="Anonymous Speaker Diarization Worker")
    parser.add_argument("--check-available", action="store_true", help="Check if pyannote and torch dependencies are available")
    parser.add_argument("--audio", type=str, help="Path to normalized 16kHz WAV audio file")
    parser.add_argument("--hf-token", type=str, help="Hugging Face authentication token")
    parser.add_argument("--model", type=str, default="pyannote/speaker-diarization-community-1", help="Pyannote model name or path")
    parser.add_argument("--device", type=str, choices=["cpu", "cuda"], help="Computation device (cpu or cuda)")
    parser.add_argument("--output", type=str, help="Optional output JSON file path")

    args = parser.parse_args()

    if args.check_available:
        result = check_availability()
        print(json.dumps(result, indent=2))
        sys.exit(0)

    if not args.audio:
        sys.stderr.write("Error: --audio argument is required when not using --check-available.\n")
        parser.print_help(sys.stderr)
        sys.exit(2)

    result = run_diarization(
        audio_path=args.audio,
        hf_token=args.hf_token,
        model_name=args.model,
        device_name=args.device
    )

    result_json = json.dumps(result, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result_json)
    else:
        print(result_json)

    if "error" in result:
        sys.exit(1)

if __name__ == "__main__":
    main()

