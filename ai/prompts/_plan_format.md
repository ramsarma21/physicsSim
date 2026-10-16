# The plan (JSON)
```
{
  "title": "short name of the scene (2-6 words)",
  "seconds": 5,                      // how long the run lasts, 0.5-20: long enough for the whole story to finish, plus about 1 s
  "release": 0.5,                    // optional: when held items let go (s), default 0.5
  "items": [                         // everything in the scene except the table (it is always there, id "table")
    {
      "id": "ramp",                  // unique, short, lowercase: letters, digits, - or _ (not "table" or "air")
      "type": "plank",               // a catalog key, exactly
      "name": "Ramp",                // what the user would call it
      "props": {"length": 0.8},      // only props listed for that type, inside their ranges; leave out what stays at its default
      "place": {"on": "air", "lean": {"from": {"on": "air", "x": 0.0, "y": 0.4}, "to": {"on": "table", "x": 0.7}}},
      "held": false, "fixed": false,  // optional (dynamic items only)
      "why": "what it is for, in a few words (and what it stands in for, when it is a substitute)"
    }
  ],
  "missing": [                       // EVERY requested thing the catalog does not have (or cannot do), honestly; [] if none
    {"asked": "a dog", "reason": "there are no animals in the library", "substitute_type": null, "substitute_id": null}
  ],
  "goals": [                         // every outcome the request states or the picture shows that can be checked; [] otherwise
    {"kind": "in", "label": "The ball lands in the bucket", "item": "ball", "container": "bucket"},  // container: a box, cup, bucket, basket, plastic cup, glass jar or coffee mug item
    {"kind": "falls", "label": "All the dominoes fall", "item": "dominoes"},       // or "items": ["d1", "d2", ...]: every one must end tipped over or knocked down
    {"kind": "hits", "label": "The pendulum hits the brick", "item": "pendulum", "target": "brick", "before_s": 4},  // they touch during the run (before_s optional; resting contact from the start does not count)
    {"kind": "moves", "label": "The cart rolls off", "item": "cart", "min_m": 0.3},  // it ends at least min_m from where it started
    {"kind": "off", "label": "The ping-pong ball is blown off the edge", "item": "pingpong"}  // it ends off the table (past an end, or fallen below its top)
  ],
  "tune": [                          // knobs a tuner may turn to make the goals happen (1-4 is typical; [] without goals)
    {"id": "bucket", "param": "x", "min": 1.4, "max": 2.4}                             // param: "x", "y", "angle" or a number prop of that item
  ],
  "stages": [                        // ONLY for a chain of 4 or more stages: each stage in order, what it must do, a check the run can test, its knobs
    {"label": "Pendulum hits the ball", "does": "swings down from 60° and hits the wooden ball at about 0.5 s", "items": ["pendulum", "ball"],
     "check": {"kind": "hits", "item": "pendulum", "target": "ball", "before_s": 1.5},     // a goal (in, falls, hits, moves, off) on this stage's own items
     "tune": [{"id": "pendulum", "param": "start_angle", "min": 40, "max": 80}]}          // this stage's knobs (0-3), not repeated in another stage
  ],
  "notes": "one or two sentences: how the scene works and anything the user should know",
  "assumptions": ["choices you made that the request did not settle (and which known-size thing set the scale)"],
  "differences": ["what differs from the picture or the request, and why: 'red ball: the library's wooden ball is brown'"],   // [] if none
  "reply": "I built a steel ball that rolls down a 35 cm ramp into a row of 12 dominoes.",   // for the chat: see "The reply" below
  "suggestions": [                   // 2-3 next edits of THIS scene, as one-click chips: see below
    {"label": "Start a bigger domino wave", "prompt": "Make the dominoes grow in size so the wave builds up, and keep the ramp and the ball as they are"},
    {"label": "Finish with a bell", "prompt": "Add a bell at the end of the domino row that the last domino rings"}
  ],
  "covers": [                        // ONLY when an observation of pictures is given: every observed object, by its exact label
    {"label": "inclined base board", "ids": ["base"]},
    {"label": "launcher legs", "ids": ["launcher"], "note": "part of the spring launcher"},
    {"label": "hand", "ids": [], "note": "a person's hand: not in the library"}
  ]
}
```
**The reply** (`reply`): at most 2 short sentences, first person ("I built…", "I made…"), plain words the user would use, real units (cm, m, g, kg, s, °), never prop or item ids, field names or arrows of raw values ("first_height 0.098 → 0.13"). Say what you made, and anything the user must know (a substitute, a thing the library lacks). Not a list of every item.
**The suggestions** (`suggestions`): 2 or 3 next edits a helpful assistant would offer for THIS scene: one that makes the outcome more reliable or fixes its weakest step, one that makes it more fun or dramatic, or a natural next step. Each `{"label": "≤ 6 words, an action", "prompt": "the whole request, as the user would type it, naming the items, under 20 words"}`. Specific to this scene, never generic ("add more items", "change the colours").

Optional, only when the request needs it: `"table": {"props": {"width": 5, "material": "steel"}}` (the table's own props) and `"stage": {"x0": ..., "x1": ..., "y0": ..., "y1": ...}` (a bigger or smaller frame, in metres).
