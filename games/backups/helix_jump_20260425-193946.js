let THREE, scene, camera, renderer;
let ball, towerGroup, centralPillar;
let logicalLevels = [];
let score = 0, lives = 1, gameState = 'PLAYING';
let velocityY = 0;
let maxPassedLevel = -1;
let lowestBallY = 4.0;

const gravity = 18.0;
const bounceSpeed = 8.5;
const levelSpacing = 4.0;
const platformThickness = 0.5;
const ballRadius = 0.4;
const numLevels = 25;

let ballMat, pillarMat, safeMat, dangerMat, winMat;

function setup(context) {
    THREE = context.THREE;
    renderer = context.renderer;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222233);

    camera = new THREE.PerspectiveCamera(60, context.width / context.height, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 2);
    scene.add(dirLight);

    ballMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    pillarMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    safeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    dangerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    winMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    ball = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 16, 16), ballMat);
    scene.add(ball);

    towerGroup = new THREE.Group();
    scene.add(towerGroup);

    centralPillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 1, 16),
        pillarMat
    );
    towerGroup.add(centralPillar);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    velocityY = 0;
    maxPassedLevel = -1;

    // Randomize colors for visual variation
    let hue = Math.random();
    ballMat.color.setHSL((hue + 0.5) % 1.0, 0.8, 0.5);
    safeMat.color.setHSL(hue, 0.7, 0.5);
    dangerMat.color.setHSL((hue + 0.15) % 1.0, 0.8, 0.5);
    winMat.color.setHSL((hue + 0.75) % 1.0, 0.9, 0.6);
    scene.background.setHSL(hue, 0.2, 0.15);

    // Clear old platform geometries
    for (let i = towerGroup.children.length - 1; i >= 0; i--) {
        let child = towerGroup.children[i];
        if (child !== centralPillar) {
            if (child.geometry) child.geometry.dispose();
            towerGroup.remove(child);
        }
    }

    logicalLevels = [];
    towerGroup.rotation.y = 0;

    // Generate tower levels
    for (let i = 0; i <= numLevels; i++) {
        let y = -i * levelSpacing;
        let levelSegments = [];

        if (i === numLevels) {
            // Bottom win level (solid)
            levelSegments.push({ start: 0, length: Math.PI * 2, type: 'win' });
            let mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(3.0, 3.0, platformThickness, 32, 1, false, 0, Math.PI * 2), 
                winMat
            );
            mesh.position.y = y;
            towerGroup.add(mesh);
        } else {
            // Standard level with a gap
            let currentTheta = Math.random() * Math.PI * 2;
            let gapLength = Math.random() * (Math.PI / 2) + Math.PI / 4; // 45 to 135 degrees gap
            let remaining = 2 * Math.PI - gapLength;
            currentTheta += gapLength;

            let isFirstSegment = true;
            while (remaining > 0.001) {
                let len = Math.min(remaining, Math.random() * Math.PI / 2 + Math.PI / 4);
                if (remaining - len < 0.1) len = remaining; // snap to close the circle

                let type = 'safe';
                if (i > 0 && !isFirstSegment) {
                    type = Math.random() < 0.4 ? 'danger' : 'safe';
                }

                levelSegments.push({ start: normalizeAngle(currentTheta), length: len, type: type });

                let mesh = new THREE.Mesh(
                    new THREE.CylinderGeometry(3.0, 3.0, platformThickness, 16, 1, false, currentTheta, len),
                    type === 'danger' ? dangerMat : safeMat
                );
                mesh.position.y = y;
                towerGroup.add(mesh);

                currentTheta += len;
                remaining -= len;
                isFirstSegment = false;
            }
        }
        logicalLevels.push({ y: y, segments: levelSegments });
    }

    // Adjust central pillar to cover the entire tower height
    let totalHeight = numLevels * levelSpacing + 6.0;
    centralPillar.scale.y = totalHeight;
    centralPillar.position.y = 4.0 - totalHeight / 2.0;

    // Reset ball position (ball always stays at X=2.2, Z=0)
    ball.position.set(2.2, 2.0, 0);
    lowestBallY = ball.position.y;

    updateCamera();
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    const a = globalThis.currentAction;
    const rotateSpeed = 4.5;
    
    // Rotate the tower based on input
    if (a === 1) towerGroup.rotation.y -= rotateSpeed * dt;
    if (a === 2) towerGroup.rotation.y += rotateSpeed * dt;

    let oldY = ball.position.y;
    velocityY -= gravity * dt;
    ball.position.y += velocityY * dt;

    // Check collisions if ball is falling
    if (velocityY < 0) {
        let newBottom = ball.position.y - ballRadius;
        let oldBottom = oldY - ballRadius;

        // Ball is at world angle 0 (X=2.2, Z=0). Local angle depends on tower rotation.
        let localAngle = normalizeAngle(-towerGroup.rotation.y);

        for (let i = Math.max(0, maxPassedLevel); i < logicalLevels.length; i++) {
            let level = logicalLevels[i];
            let platformTop = level.y + platformThickness / 2;

            if (oldBottom >= platformTop && newBottom <= platformTop) {
                // Ball crossed the top plane of this platform
                let hitType = 'gap';
                
                for (let seg of level.segments) {
                    let s = seg.start;
                    let e = normalizeAngle(seg.start + seg.length);
                    let inSeg = false;
                    
                    if (s < e) {
                        inSeg = localAngle >= s && localAngle <= e;
                    } else {
                        inSeg = localAngle >= s || localAngle <= e;
                    }
                    
                    if (inSeg) {
                        hitType = seg.type;
                        break;
                    }
                }

                if (hitType === 'safe') {
                    ball.position.y = platformTop + ballRadius;
                    velocityY = bounceSpeed;
                } else if (hitType === 'danger') {
                    ball.position.y = platformTop + ballRadius;
                    gameState = 'GAMEOVER';
                } else if (hitType === 'win') {
                    ball.position.y = platformTop + ballRadius;
                    gameState = 'WIN';
                    score += 50;
                } else if (hitType === 'gap') {
                    if (i > maxPassedLevel) {
                        maxPassedLevel = i;
                        score += 10;
                    }
                }
            }
        }
    }

    if (ball.position.y < lowestBallY) {
        lowestBallY = ball.position.y;
    }

    updateCamera();
}

function updateCamera() {
    // Camera positioned at +X looking towards -X to see the ball cleanly in the foreground
    camera.position.set(10.0, lowestBallY + 5.0, 0.0);
    camera.lookAt(0.0, lowestBallY - 2.0, 0.0);
}

function render() {
    renderer.render(scene, camera);
}

function getGameState() {
    return { score, lives, gameState };
}

function normalizeAngle(a) {
    let res = a % (2 * Math.PI);
    if (res < 0) res += 2 * Math.PI;
    return res;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}