let THREE, renderer, width, height, scene, camera;
let score = 0, lives = 3, playerHP = 10, gameState = 'PLAYING';
let player;
let entities = [];
let bullets = [];
let scraps = [];
let particles = [];
let buildings = [];

const MAX_HP = 10;
let geos = {}, mats = {};

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}

function setup(args) {
    THREE = args.THREE;
    renderer = args.renderer;
    width = args.width;
    height = args.height;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    let dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(10, 20, 10);
    scene.add(dl);

    geos.player = new THREE.BoxGeometry(1, 1, 1);
    geos.gun = new THREE.BoxGeometry(0.2, 0.2, 0.6);
    geos.building = new THREE.BoxGeometry(8, 20, 8);
    geos.crate = new THREE.BoxGeometry(2, 2, 2);
    geos.enemy = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    geos.bossCore = new THREE.BoxGeometry(4, 4, 4);
    geos.bossArm = new THREE.BoxGeometry(1.5, 3, 1.5);
    geos.bullet = new THREE.SphereGeometry(0.3, 8, 8);
    geos.scrap = new THREE.OctahedronGeometry(0.4);
    geos.floor = new THREE.PlaneGeometry(120, 120);

    mats.player = new THREE.MeshLambertMaterial({color: 0x0f52ba});
    mats.gun = new THREE.MeshLambertMaterial({color: 0x333333});
    mats.building = new THREE.MeshLambertMaterial({color: 0x2b2b36});
    mats.crate = new THREE.MeshLambertMaterial({color: 0x8b5a2b});
    mats.enemy = new THREE.MeshLambertMaterial({color: 0x8b0000});
    mats.bossCore = new THREE.MeshLambertMaterial({color: 0x220000});
    mats.bossArm = new THREE.MeshLambertMaterial({color: 0x550000});
    mats.pBullet = new THREE.MeshBasicMaterial({color: 0x00ffff});
    mats.eBullet = new THREE.MeshBasicMaterial({color: 0xff00ff});
    mats.scrap = new THREE.MeshBasicMaterial({color: 0x00ff00});
    mats.floor = new THREE.MeshLambertMaterial({color: 0x111118});
    mats.pParticle = new THREE.MeshBasicMaterial({color: 0xffaa00});
    mats.eParticle = new THREE.MeshBasicMaterial({color: 0xff0000});
}

function spawnCrate(x, z) {
    let c = new THREE.Mesh(geos.crate, mats.crate);
    c.position.set(x, 1, z);
    scene.add(c);
    entities.push({
        mesh: c, type: 'crate', hp: 1, radius: 1.4
    });
}

function spawnEnemy(x, z) {
    let e = new THREE.Mesh(geos.enemy, mats.enemy);
    let eye = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.2), mats.eParticle);
    eye.position.set(0, 0.2, -0.8);
    e.add(eye);
    e.position.set(x, 0.75, z);
    scene.add(e);
    entities.push({
        mesh: e, type: 'enemy', hp: 3, radius: 1.0,
        timer: Math.random() * 2, state: 'patrol',
        targetX: x, targetZ: z,
        shootTimer: Math.random() * 2
    });
}

function spawnBoss(x, z) {
    let core = new THREE.Mesh(geos.bossCore, mats.bossCore);
    let eye = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.5), mats.eParticle);
    eye.position.set(0, 1, -2);
    core.add(eye);
    core.position.set(x, 2, z);
    scene.add(core);
    
    let lArm = new THREE.Mesh(geos.bossArm, mats.bossArm);
    scene.add(lArm);
    
    let rArm = new THREE.Mesh(geos.bossArm, mats.bossArm);
    scene.add(rArm);
    
    let bossObj = {
        mesh: core, type: 'boss', hp: 20, radius: 2.8,
        bx: x, bz: z,
        arms: [
            {mesh: lArm, hp: 10, radius: 1.5, side: -1},
            {mesh: rArm, hp: 10, radius: 1.5, side: 1}
        ],
        timer: 0, shootTimer: 1
    };
    entities.push(bossObj);
}

function spawnBullet(x, y, z, dx, dz, owner) {
    let mat = owner === 'player' ? mats.pBullet : mats.eBullet;
    let b = new THREE.Mesh(geos.bullet, mat);
    b.position.set(x, y, z);
    scene.add(b);
    let speed = owner === 'player' ? 30 : 15;
    bullets.push({
        mesh: b, x, y, z, vx: dx * speed, vz: dz * speed, owner: owner, life: 1.5
    });
}

function spawnScrap(x, z) {
    let s = new THREE.Mesh(geos.scrap, mats.scrap);
    s.position.set(x, 0.4, z);
    scene.add(s);
    scraps.push({mesh: s, x: x, z: z, life: 15});
}

function spawnParticles(x, y, z, type) {
    let m = type === 'hit' ? mats.pParticle : mats.eParticle;
    for(let i = 0; i < 6; i++) {
        let p = new THREE.Mesh(geos.scrap, m);
        p.position.set(x, y, z);
        p.scale.setScalar(0.4);
        scene.add(p);
        particles.push({
            mesh: p,
            vx: (Math.random() - 0.5) * 15,
            vy: Math.random() * 15,
            vz: (Math.random() - 0.5) * 15,
            life: 0.4 + Math.random() * 0.3
        });
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    
    score = 0;
    lives = 3;
    playerHP = MAX_HP;
    gameState = 'PLAYING';

    while(scene.children.length > 0) { 
        scene.remove(scene.children[0]); 
    }

    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    let dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(10, 20, 10);
    scene.add(dl);

    let floor = new THREE.Mesh(geos.floor, mats.floor);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    entities = [];
    bullets = [];
    scraps = [];
    particles = [];
    buildings = [];

    player = new THREE.Mesh(geos.player, mats.player);
    let gun = new THREE.Mesh(geos.gun, mats.gun);
    gun.position.set(0, 0, -0.6);
    player.add(gun);
    player.position.set(0, 0.5, 42);
    scene.add(player);
    
    player.userData = {
        vx: 0, vy: 0, vz: 0,
        facing: new THREE.Vector3(0, 0, -1),
        invincibility: 0,
        shootCooldown: 0
    };

    for(let i = -4; i <= 4; i++) {
        for(let j = -4; j <= 4; j++) {
            if(j === -4 && i >= -2 && i <= 1) continue; // Boss arena

            let bx = i * 12 + 6;
            let bz = j * 12 + 6;
            
            if(Math.random() < 0.3) {
                let scaleY = 0.5 + Math.random() * 1.5;
                let b = new THREE.Mesh(geos.building, mats.building);
                b.scale.set(1, scaleY, 1);
                let h = 20 * scaleY;
                b.position.set(bx, h / 2, bz);
                scene.add(b);
                buildings.push({x: bx, z: bz, w: 8, d: 8, h: h});
            }
            
            if(Math.random() < 0.4) spawnCrate(bx - 5, bz + (Math.random() - 0.5) * 4);
            if(Math.random() < 0.4) spawnCrate(bx + 5, bz + (Math.random() - 0.5) * 4);
            if(Math.random() < 0.4) spawnCrate(bx + (Math.random() - 0.5) * 4, bz - 5);
        }
    }

    for(let i = -4; i <= 4; i++) {
        for(let j = -4; j <= 3; j++) {
            if(Math.random() < 0.35 && (i !== 0 || j !== 4) && (i !== 0 || j !== -4)) {
                spawnEnemy(i * 12, j * 12);
            }
        }
    }

    spawnBoss(0, -42);
    camera.position.set(0, 4, 47);
}

function update(dt) {
    if(gameState !== 'PLAYING') return;

    let action = globalThis.currentAction;
    let up = [3, 5, 6, 13].includes(action);
    let down = [4, 7, 8, 14].includes(action);
    let left = [1, 5, 7, 11].includes(action);
    let right = [2, 6, 8, 12].includes(action);
    let shoot = [9, 11, 12, 13, 14].includes(action);
    let jump = (action === 10);

    if(player.userData.invincibility > 0) player.userData.invincibility -= dt;
    if(player.userData.shootCooldown > 0) player.userData.shootCooldown -= dt;

    let speed = 12;
    let dx = 0, dz = 0;
    if(up) dz -= 1;
    if(down) dz += 1;
    if(left) dx -= 1;
    if(right) dx += 1;

    if(dx !== 0 || dz !== 0) {
        let len = Math.sqrt(dx * dx + dz * dz);
        dx /= len; dz /= len;
        player.userData.facing.set(dx, 0, dz);
        player.userData.vx = dx * speed;
        player.userData.vz = dz * speed;
    } else {
        player.userData.vx *= 0.8;
        player.userData.vz *= 0.8;
        if(Math.abs(player.userData.vx) < 0.1) player.userData.vx = 0;
        if(Math.abs(player.userData.vz) < 0.1) player.userData.vz = 0;
    }

    if(jump && player.position.y <= 0.51) {
        player.userData.vy = 16;
    }

    player.userData.vy -= 40 * dt;

    let nx = player.position.x + player.userData.vx * dt;
    let ny = player.position.y + player.userData.vy * dt;
    let nz = player.position.z + player.userData.vz * dt;

    if(ny <= 0.5) {
        ny = 0.5;
        player.userData.vy = 0;
    }

    let pRad = 0.5;
    nx = Math.max(-49, Math.min(49, nx));
    nz = Math.max(-49, Math.min(49, nz));

    for(let b of buildings) {
        let minX = b.x - b.w / 2 - pRad;
        let maxX = b.x + b.w / 2 + pRad;
        let minZ = b.z - b.d / 2 - pRad;
        let maxZ = b.z + b.d / 2 + pRad;
        
        if(nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
            let dxLeft = nx - minX;
            let dxRight = maxX - nx;
            let dzTop = nz - minZ;
            let dzBot = maxZ - nz;
            
            let min = Math.min(dxLeft, dxRight, dzTop, dzBot);
            if(min === dxLeft) nx = minX;
            else if(min === dxRight) nx = maxX;
            else if(min === dzTop) nz = minZ;
            else nz = maxZ;
        }
    }

    for(let e of entities) {
        if(e.hp > 0 && e.type === 'crate') {
            let cr = e.radius + pRad;
            let cdx = nx - e.mesh.position.x;
            let cdz = nz - e.mesh.position.z;
            let cdist = Math.hypot(cdx, cdz);
            if(cdist < cr) {
                nx = e.mesh.position.x + (cdx / cdist) * cr;
                nz = e.mesh.position.z + (cdz / cdist) * cr;
            }
        }
        if(e.hp > 0 && e.type === 'boss') {
            let cr = e.radius + pRad;
            let cdx = nx - e.mesh.position.x;
            let cdz = nz - e.mesh.position.z;
            let cdist = Math.hypot(cdx, cdz);
            if(cdist < cr) {
                nx = e.mesh.position.x + (cdx / cdist) * cr;
                nz = e.mesh.position.z + (cdz / cdist) * cr;
            }
            for(let a of e.arms) {
                if(a.hp > 0) {
                    let ar = a.radius + pRad;
                    let adx = nx - a.mesh.position.x;
                    let adz = nz - a.mesh.position.z;
                    let adist = Math.hypot(adx, adz);
                    if(adist < ar) {
                        nx = a.mesh.position.x + (adx / adist) * ar;
                        nz = a.mesh.position.z + (adz / adist) * ar;
                    }
                }
            }
        }
    }

    player.position.set(nx, ny, nz);
    let angle = Math.atan2(player.userData.facing.x, player.userData.facing.z);
    player.rotation.y = angle;

    if(shoot && player.userData.shootCooldown <= 0) {
        player.userData.shootCooldown = 0.15;
        let gx = player.position.x + player.userData.facing.x * 0.8;
        let gz = player.position.z + player.userData.facing.z * 0.8;
        spawnBullet(gx, player.position.y, gz, player.userData.facing.x, player.userData.facing.z, 'player');
    }

    player.visible = !(player.userData.invincibility > 0 && Math.floor(player.userData.invincibility * 15) % 2 === 0);

    for(let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.life -= dt;
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.mesh.position.set(b.x, b.y, b.z);
        
        let hit = false;
        for(let bd of buildings) {
            if(b.x > bd.x - bd.w / 2 && b.x < bd.x + bd.w / 2 && b.z > bd.z - bd.d / 2 && b.z < bd.z + bd.d / 2 && b.y < bd.h) {
                hit = true; break;
            }
        }
        
        if(!hit) {
            if(b.owner === 'player') {
                for(let e of entities) {
                    if(e.hp > 0) {
                        if(e.type === 'boss') {
                            for(let a of e.arms) {
                                if(a.hp > 0 && Math.hypot(b.x - a.mesh.position.x, b.z - a.mesh.position.z) < a.radius) {
                                    a.hp -= 1;
                                    hit = true;
                                    spawnParticles(b.x, b.y, b.z, 'hit');
                                    if(a.hp <= 0) {
                                        scene.remove(a.mesh);
                                        score += 50;
                                    }
                                    break;
                                }
                            }
                            if(hit) break;
                        }
                        if(Math.hypot(b.x - e.mesh.position.x, b.z - e.mesh.position.z) < e.radius) {
                            e.hp -= 1;
                            hit = true;
                            spawnParticles(b.x, b.y, b.z, 'hit');
                            if(e.hp <= 0) {
                                if(e.type === 'crate') {
                                    spawnScrap(e.mesh.position.x, e.mesh.position.z);
                                    scene.remove(e.mesh);
                                } else if(e.type === 'enemy') {
                                    score += 50;
                                    spawnScrap(e.mesh.position.x, e.mesh.position.z);
                                    scene.remove(e.mesh);
                                } else if(e.type === 'boss') {
                                    score += 500;
                                    gameState = 'WIN';
                                    scene.remove(e.mesh);
                                    for(let a of e.arms) scene.remove(a.mesh);
                                }
                            }
                            break;
                        }
                    }
                }
            } else {
                if(player.userData.invincibility <= 0 && Math.hypot(b.x - player.position.x, b.z - player.position.z) < 0.8 && Math.abs(b.y - player.position.y) < 1.0) {
                    playerHP -= 1;
                    player.userData.invincibility = 1.0;
                    hit = true;
                    spawnParticles(b.x, b.y, b.z, 'enemyHit');
                    if(playerHP <= 0) {
                        lives -= 1;
                        if(lives <= 0) gameState = 'GAMEOVER';
                        else playerHP = MAX_HP;
                    }
                }
            }
        }
        
        if(hit || b.life <= 0) {
            scene.remove(b.mesh);
            bullets.splice(i, 1);
        }
    }

    for(let i = entities.length - 1; i >= 0; i--) {
        let e = entities[i];
        if(e.hp <= 0) {
            entities.splice(i, 1);
            continue;
        }
        
        if(e.type === 'enemy') {
            e.timer -= dt;
            if(e.timer <= 0) {
                e.timer = 1 + Math.random();
                e.targetX = e.mesh.position.x + (Math.random() - 0.5) * 15;
                e.targetZ = e.mesh.position.z + (Math.random() - 0.5) * 15;
                e.targetX = Math.max(-48, Math.min(48, e.targetX));
                e.targetZ = Math.max(-48, Math.min(48, e.targetZ));
            }
            let edx = e.targetX - e.mesh.position.x;
            let edz = e.targetZ - e.mesh.position.z;
            let edist = Math.hypot(edx, edz);
            if(edist > 0.1) {
                let vx = (edx / edist);
                let vz = (edz / edist);
                e.mesh.position.x += vx * 4 * dt;
                e.mesh.position.z += vz * 4 * dt;
                e.mesh.rotation.y = Math.atan2(vx, vz);
            }
            
            e.shootTimer -= dt;
            if(e.shootTimer <= 0) {
                e.shootTimer = 1.5 + Math.random();
                let pdx = player.position.x - e.mesh.position.x;
                let pdz = player.position.z - e.mesh.position.z;
                let pdist = Math.hypot(pdx, pdz);
                if(pdist < 25) {
                    spawnBullet(e.mesh.position.x, 0.75, e.mesh.position.z, pdx / pdist, pdz / pdist, 'enemy');
                }
            }
            
            if(player.userData.invincibility <= 0 && Math.hypot(player.position.x - e.mesh.position.x, player.position.z - e.mesh.position.z) < 1.2 && Math.abs(player.position.y - e.mesh.position.y) < 1.0) {
                playerHP -= 1;
                player.userData.invincibility = 1.0;
                if(playerHP <= 0) {
                    lives -= 1;
                    if(lives <= 0) gameState = 'GAMEOVER';
                    else playerHP = MAX_HP;
                }
            }
        } else if(e.type === 'boss') {
            e.timer += dt;
            e.mesh.position.x = e.bx + Math.sin(e.timer * 0.8) * 16;
            e.mesh.position.z = e.bz + Math.cos(e.timer * 1.5) * 4;
            for(let a of e.arms) {
                if(a.hp > 0) {
                    a.mesh.position.x = e.mesh.position.x + a.side * 4;
                    a.mesh.position.z = e.mesh.position.z + Math.cos(e.timer * 2) * 1.5;
                }
            }
            
            e.shootTimer -= dt;
            if(e.shootTimer <= 0) {
                e.shootTimer = 1.2;
                let pdx = player.position.x - e.mesh.position.x;
                let pdz = player.position.z - e.mesh.position.z;
                let pdist = Math.hypot(pdx, pdz);
                if(pdist < 45) {
                    let hasArms = e.arms.some(a => a.hp > 0);
                    if(hasArms || Math.random() < 0.4) {
                        spawnBullet(e.mesh.position.x, 2, e.mesh.position.z, pdx / pdist, pdz / pdist, 'enemy');
                        if(e.hp < 12) {
                            let a1 = Math.atan2(pdx, pdz) + 0.25;
                            let a2 = Math.atan2(pdx, pdz) - 0.25;
                            spawnBullet(e.mesh.position.x, 2, e.mesh.position.z, Math.sin(a1), Math.cos(a1), 'enemy');
                            spawnBullet(e.mesh.position.x, 2, e.mesh.position.z, Math.sin(a2), Math.cos(a2), 'enemy');
                        }
                    }
                }
            }
            
            if(player.userData.invincibility <= 0 && Math.hypot(player.position.x - e.mesh.position.x, player.position.z - e.mesh.position.z) < 3.5) {
                playerHP -= 2;
                player.userData.invincibility = 1.0;
                if(playerHP <= 0) {
                    lives -= 1;
                    if(lives <= 0) gameState = 'GAMEOVER';
                    else playerHP = MAX_HP;
                }
            }
        }
    }

    for(let i = scraps.length - 1; i >= 0; i--) {
        let s = scraps[i];
        s.life -= dt;
        s.mesh.rotation.y += 3 * dt;
        if(Math.hypot(player.position.x - s.x, player.position.z - s.z) < 2.0 && Math.abs(player.position.y - 0.4) < 1.5) {
            score += 10;
            scene.remove(s.mesh);
            scraps.splice(i, 1);
        } else if(s.life <= 0) {
            scene.remove(s.mesh);
            scraps.splice(i, 1);
        }
    }

    for(let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 20 * dt;
        if(p.y < 0.1) p.y = 0.1;
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.scale.setScalar(p.life * 0.8);
        if(p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    let targetCamX = player.position.x;
    let targetCamZ = player.position.z + 5;
    let targetCamY = player.position.y + 4;

    camera.position.x += (targetCamX - camera.position.x) * 4 * dt;
    camera.position.y += (targetCamY - camera.position.y) * 4 * dt;
    camera.position.z += (targetCamZ - camera.position.z) * 4 * dt;

    camera.lookAt(player.position.x, player.position.y, player.position.z - 2);
}

function render() {
    renderer.render(scene, camera);
}

function getGameState() {
    return { score, lives, hp: playerHP, gameState };
}