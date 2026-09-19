# ROM notice — `parity/chip8/roms/`

Every file here is a byte-for-byte copy from the Octax repository (https://github.com/riiswa/octax, branch main, commit `3aa53b516152e97f2ed91eae6e33b6ee9a97596b`, cloned 2026-09-19). Octax's code is MIT; its four modified builds (cavern, spacejam, flightrunner, target_shooter) ship with `.8o` sources under that license. The other ROMs are hobbyist / public-domain CHIP-8 programs whose authorship Octax records in each game module's `metadata`; that authorship is reproduced below. Human decision 2026-09-19 (PLAN.md section 9 Q3): keep the ROMs in the repo with this notice. If an author objects, remove the ROM, its `games/<game>.json` and its `dist/` bundle.

`meta sha1 ok` says whether the sha1 Octax's own metadata gives for the file matches the file (it does not for flight_runner, spacejam, worm, and the levelled games' metadata refers to other files). The bytes in the pinned commit are the reference either way.

| file | sha1 | bytes | game | title | authors | release | Octax module | modified by Octax | meta sha1 ok |
|---|---|---|---|---|---|---|---|---|---|
| Airplane.ch8 | fca71182a8838b686573e69b22aff945d79fe1d0 | 356 | airplane | Airplane | unknown | 19xx | octax/environments/airplane.py | no | yes |
| Blinky [Hans Christian Egeberg, 1991].ch8 | d40abc54374e4343639f993e897e00904ddf85d9 | 2356 | blinky | Blinky | Hans Christian Egeberg | 1991 | octax/environments/blinky.py | no | yes |
| Brix [Andreas Gustafsson, 1990].ch8 | f13766c14aeb02ad8d4d103cb5eadd282d20cddc | 280 | brix | Brix | Andreas Gustafsson | 1990 | octax/environments/brix.py | no | yes |
| cavern1.ch8 | f57c4583709022859bb7ba90cf7fc449bfaa5b26 | 3232 | cavern1 | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern2.ch8 | ae59d229d6de5762549bf9bf52c23d7fa39372c7 | 3232 | cavern2 | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern3.ch8 | df5e840c8db7acc6f63860246393ea2b8e2d3158 | 3232 | cavern3 | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern4a.ch8 | 4489020dfcd1bdc999ee68426e5af70f1901fd7a | 3232 | cavern4a | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern4b.ch8 | 579846ee7e4e2175740c96bab15151b77502bda3 | 3232 | cavern4b | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern5.ch8 | 03364866435733eb77d9771dbaffea29c691c270 | 3232 | cavern5 | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| cavern6.ch8 | f918e843647154d0ee4ae1d900592f521d6def2c | 3232 | cavern6 | Cavern | Matthew Mikolay | 2014 | octax/environments/cavern.py | yes | no |
| Deep8 (by John Earnest)(2014).ch8 | b41cc0b5b2faabafd532d705b804abb3e8f97baf | 510 | deep | Deep8 | John Earnest | 2014 | octax/environments/deep.py | no | yes |
| Filter.ch8 | ae71a7b081a947f1760cdc147759803aea45e751 | 198 | filter | Filter | unknown | ? | octax/environments/filter.py | no | yes |
| flightrunner.ch8 | 8ca4c0cdaceb9c9e135f0a56e88adaf588e71b34 | 307 | flight_runner | Flight Runner | TodPunk | 2014-11-01 | octax/environments/flight_runner.py | yes | no |
| Missile [David Winter].ch8 | 0d0cc129dad3c45ba672f85fec71a668232212cc | 180 | missile | Missile Command | David Winter | 1996 | octax/environments/missile.py | no | yes |
| Pong (1 player).ch8 | 607c4f7f4e4dce9f99d96b3182bfe7e88bb090ee | 246 | pong | Pong | 1 player | ? | octax/environments/pong.py | no | yes |
| Rocket [Joseph Weisbecker, 1978].ch8 | 3d1d029d6e31206d245c0ba881c0d1f003953bad | 130 | rocket | Rocket | Joseph Weisbecker | 1978-12 | octax/environments/rocket.py | no | yes |
| Shooting Stars [Philip Baltzer, 1978].ch8 | 443550abf646bc7f475ef0466f8e1232ec7474f3 | 204 | shooting_stars | Shooting Stars | Philip Baltzer | 1978 | octax/environments/shooting_stars.py | no | yes |
| space_flight1.ch8 | 1086fe15b4608581c8715618f303af911813dc8e | 431 | space_flight1 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight2.ch8 | b5de356579b3b4e83769ff21c734a0de4a57e40c | 431 | space_flight2 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight3.ch8 | f68a294a869828abf2a5f77a42cf2aa40377e742 | 431 | space_flight3 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight4.ch8 | 17332012fbe8840277c4b01162746906ef29633f | 431 | space_flight4 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight5.ch8 | 05e8e285872740154d60f3743e5a64a9f8c1d6c3 | 431 | space_flight5 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight6.ch8 | e8510d6c4ea1180f9c5dc2fcd1372518ae7f539e | 431 | space_flight6 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight7.ch8 | dc70a389b9a47bbb125e11fc2b2751ce1a7a87e1 | 431 | space_flight7 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight8.ch8 | 7f14117b1e138707ebf80ae9c5bd571d1ca46dde | 431 | space_flight8 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight9.ch8 | 6e73aec0c742fb20e057852cfce7f83b808e4fdb | 431 | space_flight9 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| space_flight10.ch8 | 621dc9c9e7ecafc00ad73f5d3421407ae7b12be2 | 431 | space_flight10 | Space Flight | unknown | 19xx | octax/environments/space_flight.py | no | no |
| spacejam.ch8 | 8d7fd91cefb8dcbd9faa270e6f39fbab73713f5b | 861 | spacejam | Spacejam! | WilliamDonnelly | 2015-10-30 | octax/environments/spacejam.py | yes | no |
| Squash [David Winter].ch8 | a58ec7cc63707f9e7274026de27c15ec1d9945bd | 211 | squash | Squash | David Winter | 1997 | octax/environments/squash.py | no | yes |
| Submarine [Carmelo Cortez, 1978].ch8 | 89aadf7c28bcd1c11e71ad9bd6eeaf0e7be474f3 | 288 | submarine | Submarine | Carmelo Cortez | ? | octax/environments/submarine.py | no | yes |
| Tank.ch8 | 18b9d15f4c159e1f0ed58c2d8ec1d89325d3a3b6 | 560 | tank | Tank Battle | unknown | 197x | octax/environments/tank.py | no | yes |
| target_shooter1.ch8 | a57f388db66745a46a4587dc6800ff339f6bedea | 326 | target_shooter1 | Target Shooter - LLM-Generated RL Environment | Fully LLM-Generated Environment | 2024 | octax/environments/target_shooter.py | yes | no |
| target_shooter2.ch8 | 50592422956e880b8c0db188a54fa769fa0c33fc | 356 | target_shooter2 | Target Shooter - LLM-Generated RL Environment | Fully LLM-Generated Environment | 2024 | octax/environments/target_shooter.py | yes | no |
| target_shooter3.ch8 | c2320a6f71efa1d57fc650608015ba429ca337dd | 448 | target_shooter3 | Target Shooter - LLM-Generated RL Environment | Fully LLM-Generated Environment | 2024 | octax/environments/target_shooter.py | yes | no |
| Tetris [Fran Dachille, 1991].ch8 | 5f518084744bf3cb8733f6e5454dfd1634320563 | 494 | tetris | Tetris | Fran Dachille | 1991 | octax/environments/tetris.py | no | yes |
| UFO [Lutz V, 1992].ch8 | bdb92475acfe11bc7814a2f5eade13fcd09b756a | 224 | ufo | UFO | Lutz V | 1992 | octax/environments/ufo.py | no | yes |
| Vertical Brix [Paul Robson, 1996].ch8 | da710f631f8e35534d0b9170bcf892a60f49c43d | 507 | vertical_brix | Vertical Brix | Paul Robson | 1996 | octax/environments/vertical_brix.py | no | yes |
| Wipe Off [Joseph Weisbecker].ch8 | d666688a8fce468a7d88b536bc1ef5f35ba12031 | 206 | wipe_off | Wipe Off | Joseph Weisbecker | 19xx | octax/environments/wipe_off.py | no | yes |
| Worm V4 [RB-Revival Studios, 2007].ch8 | 54b2b475e8522421be83b643d50f48a1ccaab74f | 600 | worm | SuperWorm V4 | RB-Revival Studios, Martijn Wenting | 2007 | octax/environments/worm.py | no | no |

39 ROM files, 22 game modules. Generated by tools/rom_notice.py from manifest.json; do not edit by hand.
