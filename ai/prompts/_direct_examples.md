# Three worked examples

Each shows what a director was given (the source and the digest, as you get them) and the plan it wrote. They passed the measured net and the vision check. Read them for the thinking, not as templates: your scene is not theirs.

## Example 1: a laser bounces off a mirror (a still run: the camera tells the story)

Source: kind demo. Question: "What happens to the light when it hits the mirror?" Answer: "It bounces off. The angle going out is the same as the angle coming in."

Digest:
```
SCENE demo-mirror "Angle in equals angle out": 1 s, release 0.5. Table top y = 0, x -0.55..3.15. Metres: x right, y up.
CAST (boxes are physics outlines at the start; swept: the box over the whole run; drawn models are a little larger)
  laser  primary  laser-pointer  "Laser"  x 0.13..0.27 y 0.24..0.26 (0.14 m x 1.4 cm)  roles: actor
  mirror  primary  mirror  "Mirror"  x 0.75..0.85 y 0.16..0.34 (0.11 m x 0.18 m)
  target  primary  light-sensor  "Target"  x 0.55..0.56 y 0.67..0.7 (1 cm x 3 cm)  roles: target,instrument
  scenery (never frame for its own sake): table
MOMENTS beam:laser:on 0 | pause:setup 0 | start 0 | pause:result 0.5 | release 0.5 | result 0.5 | end 1
EVENTS event:light:laser 0 "Laser's light reaches Mirror" | event:light:mirror 0 "Laser's light reaches Mirror" | event:light:laser#2 0 "Laser's light reaches Target" | event:light:target 0 "Laser's light reaches Target"
STEADY READINGS laser.on 1, mirror.light_w 0.0001, mirror.beam_in_deg 0, mirror.aim_for:target 149.8, target.light_w 0.0001, target.hit 1, target.mw 0.9
BEAM laser (laser): on from 0 s; drawn 1.6 mm wide (its core reads in a window up to 2.05 m wide)
  0.05..1 s (the same path): source (0.271, 0.25) -> bounce:1 on mirror at (0.797, 0.25): normal (-0.866, 0.5), in 30 deg, out 30 deg, turns 120 deg -> hit:target at (0.555, 0.668); segment 1 0.526 m, segment 2 0.483 m
INSTRUMENTS target reads light_w, hit, mw (at the end: light_w 0.0001, hit 1, mw 0.9)
PATHS none published by the modules (hoses, wires): travel {through: [...]} the items along a route instead
```

Why this plan: the run is still (the beam is on from the start and nothing moves), so every shot freezes `release` and the camera does the telling: start on the cause, ride the light to the mirror at a walking pace, stop on the bounce, ride on to the target, back up to the whole V square on, then push in on the corner and show the normal and two measured arcs for the question. The laser is 0.14 m long, so a 0.42 m window keeps it at about 0.145 of the picture; the beam's core stays visible because every window is under 2 m.

Plan:
```
{
 "version": 1,
 "title": "Angle in equals angle out",
 "about": "Light from a laser goes straight to a mirror and bounces off it at the same angle it came in.",
 "grade": 4,
 "source": {"kind":"demo","scene":"demo-mirror","question":"What happens to the light when it hits the mirror?","answer":"It bounces off. The angle going out is the same as the angle coming in."},
 "story": [
  {"id":"laser","kind":"setup","says":"Light comes out of the laser.","evidence":[{"item":"laser"},{"beam":"laser","segment":1}]},
  {"id":"straight","kind":"action","says":"It goes straight to the mirror.","evidence":[{"beam":"laser","segment":1}]},
  {"id":"bounce","kind":"key","says":"It bounces off the mirror.","evidence":[{"beam":"laser","bounce":1},{"item":"mirror"}]},
  {"id":"onward","kind":"action","says":"It goes straight on to the target.","evidence":[{"beam":"laser","segment":2},{"item":"target"}]},
  {"id":"path","kind":"reveal","says":"The whole path: laser, mirror, target.","evidence":[{"beam":"laser"}]},
  {"id":"angles","kind":"pause","says":"The angle in is the same as the angle out.","evidence":[{"beam":"laser","bounce":1}]}
 ],
 "output": {"aspect":"16:9","fps":60},
 "look": {"backdrop":"studio","tone":"dark","ground":"sweep","light":"subject"},
 "shots": [
  {"id":"tip","beat":"laser","intent":"Start on the cause: the laser and the thin line of light leaving its tip, placed left so the light has room to go right, where the story goes.","run":{"freeze":"release","seconds":1.4},"move":"hold","subject":{"item":"laser"},"frame":{"width":0.42},"place":"left-third","view":"eye","lens":50,"audit":{"question":"Can a child see a thin bright line of light coming out of the laser?","key":"middle","must_see":[{"item":"laser"}]}},
  {"id":"to-mirror","beat":"straight","in":"continue","intent":"Ride along the beam at a walking pace: the straight line is the path the light takes, and the camera takes it too. Light is really instant; the ride is a way of looking, over a held moment.","run":{"freeze":"release"},"move":"travel","subject":{"beam":"laser","segment":1},"travel":{"path":{"beam":"laser","from":"source","to":"bounce:1"},"pace":{"speed":0.22}},"frame":{"width":0.42},"view":"eye","lens":50,"audit":{"question":"Does the camera move along one straight line of light from the laser to the mirror?","key":"middle"}},
  {"id":"bounce","beat":"bounce","in":"continue","intent":"Stop where the light turns: the bright spot on the mirror, the light coming in and going out of it. Watch it bounce.","run":{"freeze":"release","seconds":1.6},"move":"hold","subject":{"beam":"laser","bounce":1},"keep":[{"item":"mirror"}],"view":"eye","lens":50,"audit":{"question":"Can a child see the light hit the mirror and leave it going a new way?","key":"middle","must_see":[{"item":"mirror"}]}},
  {"id":"to-target","beat":"onward","in":"continue","intent":"Ride the bounced light on to the target at the same pace and scale: after the bounce it is still a straight line, and it ends on the target.","run":{"freeze":"release"},"move":"travel","subject":{"beam":"laser","segment":2},"travel":{"path":{"beam":"laser","from":"bounce:1","to":"hit:target"},"pace":{"speed":0.22}},"frame":{"width":0.42},"view":"eye","lens":50,"annotate":[{"kind":"label","on":{"item":"target"},"text":"target","at":"beside"}],"audit":{"question":"Does the camera follow the bounced light in a straight line up to the target?","key":"middle"}},
  {"id":"back-up","beat":"path","in":"continue","intent":"Back up from the target until the whole path of the light fills the picture, square on: laser, mirror, target, and the V the light makes.","run":{"freeze":"release","seconds":2.8,"hold_after":0.8},"move":"pull","subject":{"item":"target"},"end":{"subject":{"beam":"laser"},"keep":[{"item":"mirror"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":1},"lens":50},"audit":{"question":"When the camera stops, is the whole path of the light, from the laser to the mirror to the target, in the picture?","key":"end","details":[{"beam":"laser","bounce":1}]}},
  {"id":"angles","beat":"angles","in":"continue","intent":"Ease in on the corner of the V, square on, until the two rays and the mirror fill the picture; then the dashed normal and two equal arcs with their measured angles appear, and hold for the question.","run":{"freeze":"release","seconds":2.2,"hold_after":3.4},"move":"push","ease":"gentle","subject":{"beam":"laser"},"end":{"subject":{"beam":"laser","bounce":1,"pad":0.16},"keep":[{"item":"mirror"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":1},"lens":50},"annotate":[{"kind":"normal","on":{"beam":"laser","bounce":1,"pad":0.16},"appear":"settled"},{"kind":"angle","on":{"beam":"laser","bounce":1,"pad":0.16},"text":"{in}° in, {out}° out","appear":"settled"}],"audit":{"question":"Can a Grade 3 child see that the angle going in and the angle going out are the same?","key":"end","details":[{"beam":"laser","bounce":1}]}}
 ],
 "notes": "The run is still (the laser is on from the start and nothing moves), so the whole video films one held moment and the camera tells the story: follow the light, watch it bounce, follow it on, back up, compare. The last two shots are square on (yaw 0, pitch 1): an angle in the machine plane only reads true when the plane faces the camera."
}
```

## Example 2: a fair test of ramp height (a comparison filmed one run per lane)

Source: kind lesson, grade 3. Question: "Is this a valid experiment to test ramp height?" Answer: "Yes. The height is different, and everything else is the same." Words on screen: "Our question: does a higher ramp make a toy roll farther? We are testing ramp height." / "Now both cars carry the same gray ball of clay." The lesson pauses at the result.

Digest:
```
=== RUN for lane top: ft_1b_car_red_clay
SCENE ft_1b_car_red_clay "ft_1b_car_red_clay": 3.9 s, release 0.3. Table top y = 0, x -0.55..3.15. Metres: x right, y up.
CAST (boxes are physics outlines at the start; swept: the box over the whole run; drawn models are a little larger)
  toy  primary  toy-car  "Red toy car"  x -0.25..-0.05 y 0.06..0.14 (0.2 m x 8.2 cm)  swept x -0.25..0.82 y 0.01..0.14  start 0.53 rest 2.62, top 0.72 m/s  held until release  parts: chassis, cabin, front, rear  roles: mover
  clay  primary  clay-lump  "Gray clay"  x -0.2..-0.12 y 0.14..0.16 (7.9 cm x 2 cm)  swept x -0.2..0.75 y 0.08..0.16  start 0.53 rest 2.62, top 0.79 m/s  roles: mover,rider
  carpet  context  carpet-strip  "Carpet"  x -0.5..2.3 y 0..0.01 (2.8 m x 1 cm)  roles: support
  ramp  context  plank  "Ramp"  x -0.35..0.25 y 0.01..0.09 (0.6 m x 7.5 cm)  roles: support
  block1  scenery  wooden-block  "Block 1"  x -0.41..-0.31 y 0.01..0.06 (10 cm x 5 cm)
  scenery (never frame for its own sake): table
MOMENTS pause:setup 0 | start 0 | release 0.3 | start:clay 0.533 | start:toy 0.533 | pause:result 2.617 | result 2.617 | stop:clay 2.617 | stop:toy 2.617 | end 3.9
CONTACTS (contact:<a>+<b> either order; #n is the pair's nth touch)
  contact:ramp+toy 1.308 s at (0.252, 0.033) 0.26 m/s; 2 touches in all (#2 1.5)
  contact:carpet+toy 1.358 s at (0.312, 0.011) 0.28 m/s; 2 touches in all (#2 1.554)
PATHS none published by the modules (hoses, wires): travel {through: [...]} the items along a route instead

=== RUN for lane bottom: ft_3b_car_red_clay
SCENE ft_3b_car_red_clay "ft_3b_car_red_clay": 3.9 s, release 0.3. Table top y = 0, x -0.55..3.15. Metres: x right, y up.
CAST (boxes are physics outlines at the start; swept: the box over the whole run; drawn models are a little larger)
  toy  primary  toy-car  "Red toy car"  x -0.23..-0.03 y 0.12..0.22 (0.2 m x 9.8 cm)  swept x -0.23..1.41 y 0.01..0.22  start 0.43 rest 2.83, top 1.32 m/s  held until release  parts: chassis, cabin, front, rear  roles: mover
  clay  primary  clay-lump  "Gray clay"  x -0.17..-0.09 y 0.21..0.24 (7.7 cm x 2.9 cm)  swept x -0.17..1.34 y 0.08..0.24  start 0.43 rest 2.83, top 1.38 m/s  roles: mover,rider
  carpet  context  carpet-strip  "Carpet"  x -0.5..2.3 y 0..0.01 (2.8 m x 1 cm)  roles: support
  ramp  context  plank  "Ramp"  x -0.33..0.26 y 0.01..0.19 (0.58 m x 0.18 m)  roles: support
  block1  other  wooden-block  "Block 1"  x -0.4..-0.3 y 0.01..0.06 (0.1 m x 5 cm)
  block2  other  wooden-block  "Block 2"  x -0.38..-0.28 y 0.06..0.11 (10 cm x 5 cm)
  block3  scenery  wooden-block  "Block 3"  x -0.39..-0.29 y 0.11..0.16 (0.1 m x 5 cm)
  scenery (never frame for its own sake): table
MOMENTS pause:setup 0 | start 0 | release 0.3 | start:clay 0.433 | start:toy 0.433 | pause:result 2.833 | result 2.833 | stop:clay 2.833 | stop:toy 2.833 | end 3.9
CONTACTS (contact:<a>+<b> either order; #n is the pair's nth touch)
  contact:carpet+toy 0.869 s at (0.306, 0.01) 0.77 m/s; 4 touches in all (#2 0.869, #3 1.002, #4 1.006)
  contact:ramp+toy 0.969 s at (0.254, 0.033) 0.29 m/s
PATHS none published by the modules (hoses, wires): travel {through: [...]} the items along a route instead

LANES (each lane is its own run; a plan's lanes.list must use exactly these ids): top = ft_1b_car_red_clay | bottom = ft_3b_car_red_clay
DIFFERS between the lanes' runs (what the comparison varies; everything else is the same):
  ramp x: top -0.048 | bottom -0.036
  ramp y: top 0.048 | bottom 0.101
  ramp angle: top -5.122 | bottom -15.537
  toy x: top -0.156 | bottom -0.139
  toy y: top 0.069 | bottom 0.141
  toy angle: top -5.122 | bottom -15.537
  clay x: top -0.161 | bottom -0.128
  clay y: top 0.153 | bottom 0.225
  clay angle: top -5.122 | bottom -15.537
  block2 only in some lanes: top not there | bottom there
  block3 only in some lanes: top not there | bottom there
```

Why this plan: the question is about the setup, so the video opens on the one difference (the blocks) with the same car and clay beside it, lets both cars roll at one scale (a pull that keeps both in their bands), shows where they stopped, and cuts back to the ramps for the pause: the pause shows the setup's evidence big, not two small cars far down the carpet. Two runs share one camera (split rows, one scale): where the cars stop is compared, so every band keeps the same world window.

Plan:
```
{
 "version": 1,
 "title": "Is it a fair test? 1 block vs 3 blocks",
 "about": "Two identical red cars with the same clay roll down ramps that differ only in height: a fair test of ramp height.",
 "grade": 3,
 "source": {"kind":"lesson","question":"Is this a valid experiment to test ramp height?","answer":"Yes. The height is different, and everything else is the same.","words":["Our question: does a higher ramp make a toy roll farther? We are testing ramp height.","Now both cars carry the same gray ball of clay."],"runs":{"top":"ft_1b_car_red_clay","bottom":"ft_3b_car_red_clay"}},
 "story": [
  {"id":"height","kind":"variable","says":"The top ramp sits on 1 block, the bottom ramp on 3; both cars are the same, with the same clay.","evidence":[{"role":"blocks"},{"role":"ramp"},{"role":"clay"}]},
  {"id":"roll","kind":"action","says":"Both cars roll down and across the carpet, and stop.","evidence":[{"role":"toy"}]},
  {"id":"pause","kind":"pause","says":"Only the blocks differ: 1 under one ramp, 3 under the other.","evidence":[{"role":"blocks"},{"role":"ramp"}]}
 ],
 "output": {"aspect":"16:9","fps":60},
 "lanes": {"arrange":"rows","list":[{"id":"top","label":"1 block","run":"ft_1b_car_red_clay","cast":{"toy":"toy","clay":"clay","ramp":"ramp","blocks":["block1"]}},{"id":"bottom","label":"3 blocks","run":"ft_3b_car_red_clay","cast":{"toy":"toy","clay":"clay","ramp":"ramp","blocks":["block1","block2","block3"]}}]},
 "look": {"backdrop":"studio","tone":"mid","ground":"sweep","light":"subject"},
 "shots": [
  {"id":"ramps","beat":"height","layout":"split","intent":"Open close on the two ramps, one band each at one scale: the blocks under each ramp are the one thing that differs, and the same red car with the same gray clay sits on each, right there to be compared.","run":{"freeze":"start","seconds":3.0},"move":"hold","subject":{"role":"blocks"},"keep":[{"role":"ramp"},{"role":"toy"},{"role":"clay"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":6},"lens":50,"annotate":[{"kind":"label","on":{"role":"blocks"},"text":"{label}"}],"audit":{"question":"Can a Grade 3 child count 1 block under the top ramp and 3 blocks under the bottom ramp, and see the same car with the same clay on each?","key":"middle","must_see":[{"role":"toy"}],"details":[{"role":"blocks"},{"role":"clay"}]}},
  {"id":"roll","beat":"roll","layout":"split","in":"continue","intent":"As the cars are let go, widen with them as they roll, both bands at once and at one scale, so neither car ever leaves the picture.","run":{"from":"start","to":"result"},"move":"pull","subject":{"role":"toy"},"keep":[{"role":"ramp"},{"role":"blocks"},{"role":"toy"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":6},"lens":50,"ease":"gentle","end":{"subject":{"role":"toy"},"keep":[{"role":"ramp"},{"role":"blocks"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":6},"lens":50},"audit":{"question":"Do both cars stay in the picture the whole time they roll?","key":"end","must_see":[{"role":"toy"}]}},
  {"id":"stops","beat":"roll","layout":"split","in":"continue","intent":"Hold still a moment as the cars come to rest: each car where it stopped, beside its own ramp.","run":{"freeze":"result","seconds":1.6},"move":"hold","subject":{"role":"toy"},"keep":[{"role":"ramp"},{"role":"blocks"}],"audit":{"question":"Can a child see where each car stopped?","key":"end","must_see":[{"role":"toy"}]}},
  {"id":"ramps-again","beat":"pause","layout":"split","in":"cut","intent":"Cut back to the two ramps for the question: the question is about the setup, so the pause shows its evidence, the blocks, labelled and big.","run":{"freeze":"result","seconds":3.2},"move":"hold","subject":{"role":"blocks"},"keep":[{"role":"ramp"}],"frame":{"fit":"snug"},"view":{"yaw":0,"pitch":6},"lens":50,"annotate":[{"kind":"label","on":{"role":"blocks"},"text":"{label}"}],"audit":{"question":"Can a child see that the only difference between the two ramps is 1 block against 3 blocks?","key":"middle","must_see":[{"role":"ramp"}],"details":[{"role":"blocks"}]}}
 ],
 "notes": "Two runs (one per lane) share one camera: the plan is solved on both lanes' things and filmed once per run with the same path. Where the cars stop is compared, so both bands keep the same world window all the way (one camera, never one per band)."
}
```

## Example 3: a four-step chain reaction (cut ahead of fast things)

Source: kind demo. Question: "What makes ball 2 go into the box?"

Digest:
```
SCENE rube-goldberg "Rube Goldberg machine": 4.5 s, release 0.5. Table top y = 0, x -0.55..3.15. Metres: x right, y up.
CAST (boxes are physics outlines at the start; swept: the box over the whole run; drawn models are a little larger)
  ramp1  primary  plank  "Ramp 1"  x -0.12..0.48 y 0.52..0.69 (0.61 m x 0.17 m)  roles: support
  ramp2  primary  plank  "Ramp 2"  x 0.52..1.74 y -0.02..0.44 (1.22 m x 0.46 m)  roles: support
  dominoes  primary  domino-row  "Dominoes"  x 1.81..2.39 y 0..0.28 (0.57 m x 0.28 m)  swept x 1.81..2.6 y 0..0.29  start 2.65 rest 3.82, top 0.82 m/s  parts: domino1, domino2, domino3, domino4, domino5, domino6, domino7  roles: mover,target
  seesaw  primary  seesaw  "Seesaw"  x 2.47..3.06 y 0..0.14 (0.59 m x 0.14 m)  swept x 2.46..3.06 y 0..0.2  start 2.88 rest 3.7, top 0.55 m/s  parts: fulcrum, plank, lip  roles: mover,target
  ball2  primary  plastic-ball  "Ball 2"  x 2.99..3.05 y 0.02..0.08 (6 cm x 6 cm)  swept x 2.62..3.05 y 0.02..0.49  start 2.85 rest 4.37, top 2.27 m/s  roles: mover,target
  box  primary  box  "Box"  x 2.61..2.87 y 0.18..0.32 (0.26 m x 0.14 m)  parts: floor, left, right  roles: target,support
  ball1  primary  superball  "Ball 1"  x -0.03..0.03 y 0.72..0.78 (6 cm x 6 cm)  swept x -0.03..1.91 y 0..0.78  start 0.57 rest 3.75, top 2.93 m/s  held until release  roles: mover,target
  scenery (never frame for its own sake): table, wall-left, wall-right
MOMENTS pause:setup 0 | start 0 | release 0.5 | start:ball1 0.567 | landing:ball1 2.138 | start:dominoes 2.65 | start:ball2 2.85 | start:seesaw 2.883 | stop:seesaw 3.7 | stop:ball1 3.75 | stop:dominoes 3.817 | pause:result 4.367 | result 4.367 | stop:ball2 4.367 | end 4.5
CONTACTS (contact:<a>+<b> either order; #n is the pair's nth touch)
  contact:ramp1+ball1 0.61 s at (-0.011, 0.661) 1.05 m/s; 5 touches in all (#2 0.8, #3 0.963, #4 1.102, #5 1.223)
  contact:ramp2+ball1 1.433 s at (0.687, 0.38) 1.31 m/s; 6 touches in all (#2 1.679, #3 1.89, #4 2.496, #5 2.556)
  contact:dominoes+ball1 1.94 s at (1.814, 0.048) 2.76 m/s; 4 touches in all (#2 2.079, #3 2.129, #4 3.025)
  contact:table+ball1 2.138 s at (1.879, 0.001) 0.63 m/s; 4 touches in all (#2 2.252, #3 2.352, #4 2.438)
  contact:dominoes+seesaw 2.819 s at (2.466, 0.136) 0.65 m/s; 2 touches in all (#2 3.256)
  contact:seesaw+ball2 2.875 s at (3.051, 0.061) 0.24 m/s; 4 touches in all (#2 2.892, #3 2.94, #4 3.01)
  contact:table+dominoes 3.05 s at (2.115, 0.001) 0.26 m/s; 2 touches in all (#2 3.092)
  contact:box+ball2 3.473 s at (2.672, 0.19) 2.09 m/s; 8 touches in all (#2 3.548, #3 3.777, #4 4.008, #5 4.181)
PATHS none published by the modules (hoses, wires): travel {through: [...]} the items along a route instead
```

Why this plan: one shot per link, in order. Ball 1 is followed down its first ramp; the dominoes fall too fast to chase, so the camera cuts ahead and waits for the ball to arrive; the seesaw's throw is over in 0.6 s, so it is slowed (and labelled) in a frame that already holds the whole flight and the box; a push rising to a high view looks over the box's wall at ball 2 inside; the whole machine closes the video as a reveal after every part was shown big (a 13x change of scale is a cut, not a pull).

Plan:
```
{
 "version": 1,
 "title": "A four-step chain",
 "about": "A ball rolls down two ramps, knocks over a row of dominoes, the last domino tips a seesaw, and the seesaw throws a second ball into a box.",
 "grade": 4,
 "source": {"kind":"demo","scene":"rube-goldberg","question":"What makes ball 2 go into the box?"},
 "story": [
  {"id":"ready","kind":"setup","says":"A ball waits at the top of a ramp.","evidence":[{"item":"ball1"},{"item":"ramp1"}]},
  {"id":"step1","kind":"chain-step","says":"1. The ball rolls down the ramps.","evidence":[{"item":"ball1"}]},
  {"id":"step2","kind":"chain-step","says":"2. It knocks the first domino; the row falls to the seesaw.","evidence":[{"item":"ball1"},{"item":"dominoes"}]},
  {"id":"step4","kind":"chain-step","says":"3. The last domino hits the seesaw, and the seesaw throws ball 2 into the box.","evidence":[{"item":"seesaw"},{"item":"ball2"},{"item":"box"}]},
  {"id":"whole","kind":"reveal","says":"One push started it all.","evidence":[{"items":["ramp1","ramp2","dominoes","seesaw","box"]}]}
 ],
 "look": {"backdrop":"studio","tone":"mid","ground":"sweep","light":"subject"},
 "shots": [
  {"id":"ready","beat":"ready","intent":"Start close on the first actor: the ball at the top of its ramp. The chain is shown as it happens, each step's next actor coming into view.","run":{"freeze":"start","seconds":1.4},"move":"hold","subject":{"item":"ball1"},"keep":[{"item":"ramp1"}],"frame":{"fit":"snug"},"view":"side","lens":50,"audit":{"question":"Can a child see the ball waiting at the top of the ramp?","key":"middle","must_see":[{"item":"ball1"}]}},
  {"id":"roll","beat":"step1","in":"continue","intent":"Go with the ball down the first ramp at its own pace, the ramp sliding by under it.","run":{"from":"start","to":{"at":"contact:ramp2+ball1","plus":-0.25}},"move":"follow","subject":{"item":"ball1"},"frame":{"width":0.8},"follow":{"axis":"xy","lead":0.25},"view":"side","lens":50,"audit":{"question":"Can a child follow the ball rolling down the first ramp?","key":"middle","must_see":[{"item":"ball1"}]}},
  {"id":"knock","beat":"step2","in":"cut","intent":"Cut ahead to the dominoes before the ball gets there and hold still: the ball comes down the last of the long ramp, strikes the first domino, and the whole row goes over. Too fast to chase, so be where it is going.","run":{"from":{"at":"contact:ramp2+ball1","plus":-0.25},"to":{"at":"contact:dominoes+seesaw","plus":-0.1}},"move":"hold","subject":{"item":"dominoes","when":"start","pad":0.04},"keep":[{"item":"dominoes","pad":0.04},{"item":"ball1","when":{"at":"contact:dominoes+ball1","plus":-0.15}}],"frame":{"fit":"snug"},"view":"side","lens":50,"audit":{"question":"Can a child see the ball hit the first domino and the dominoes fall one after another?","key":"contact:dominoes+ball1","must_see":[{"item":"dominoes","when":"contact:dominoes+ball1"}],"details":[{"item":"ball1","when":"contact:dominoes+ball1"}]}},
  {"id":"launch","beat":"step4","in":"cut","intent":"The last domino hits the seesaw and the throw is over in 0.6 s, so it plays at 0.4 speed, from a frame that already holds the seesaw, the ball's whole flight and the box.","run":{"from":{"at":"contact:dominoes+seesaw","plus":-0.1},"to":{"at":"contact:box+ball2","plus":0.3},"rate":0.4},"label":"Slow motion","move":"hold","subject":{"items":["seesaw","ball2","box"]},"keep":[{"item":"seesaw"},{"item":"box"},{"trail":"ball2","from":"start","to":"contact:box+ball2"}],"frame":{"fit":"tight"},"view":"side","lens":50,"audit":{"question":"Can a child see the last domino hit the seesaw and the seesaw flip the ball into the box?","key":"start:ball2","must_see":[{"item":"seesaw"},{"item":"box"}],"details":[{"item":"ball2"}]}},
  {"id":"lands","beat":"step4","in":"continue","intent":"Back to real speed and stay while the ball settles in the box.","run":{"from":{"at":"contact:box+ball2","plus":0.3},"to":"result","hold_after":0.4},"move":"hold","subject":{"item":"box"},"audit":{"question":"Does ball 2 stay in the box?","key":"end","must_see":[{"item":"box"}],"details":[{"item":"ball2"}]}},
  {"id":"inside","beat":"step4","in":"continue","intent":"On the held end, rise and push in over the box so its inside shows: from the side a ball in a box is hidden by the box's wall.","run":{"freeze":"result","seconds":3.0},"move":"push","subject":{"items":["seesaw","ball2","box"]},"end":{"subject":{"item":"ball2"},"keep":[{"item":"box"}],"frame":{"fit":"snug"},"view":"high","lens":50},"audit":{"question":"Can a child see ball 2 inside the box?","key":"end","must_see":[{"item":"ball2"}]}},
  {"id":"whole","beat":"whole","in":"cut","intent":"Cut to the whole machine at rest (a 13x change of scale is a cut, not a zoom): now the child sees the route the steps took, one after another.","run":{"freeze":"result","seconds":3.0},"move":"hold","subject":{"items":["ramp1","ramp2","dominoes","seesaw","box"]},"frame":{"fit":"tight"},"view":"eye","lens":50,"audit":{"question":"Can a child see the whole chain, from the first ramp to the box?","key":"middle","must_see":[{"items":["ramp1","ramp2","dominoes","seesaw","box"]}]}}
 ]
}
```
