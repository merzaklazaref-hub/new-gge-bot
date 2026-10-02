/*
 * Plugin: attack strategy base logic.
 * - Provides helper functions for wave size, flanks, and approach options.
 * - Exposes attacking algorithm for other attack plugins.
 * - Intended for worker-thread context only.
 */
if (require('node:worker_threads').isMainThread) {
    return module.exports = {
        force: true,
        pluginOptions: [
            {
                type: "Text",
                key: "attackDelaySeconds",
                default: "4.5"
            },
            {
                type: "Text",
                key: "attackDelayRandomizationSeconds",
                default: "2.5"
            },
            {
                type: "Text",
                key: "attackLimit",
                label: "Attack Limit"
            }
        ]
    }
}

const { getPermanentCastle, resources } = require('../../protocols')
const { botConfig, playerInfo, xtHandler } = require('../../ggeBot')
const stables = require('../../items/horses.json')
const { RateLimiter } = require('limiter')

const getTotalAmountTools = (e, t, n) =>
    1 === e ? t < 11 ? 10 :
        t < 37 ? 20 :
            t < 50 ? 30 :
                t < 69 ? 40 : 50 : //TODO: WTF
        t < 37 ? 10 :
            t < 50 ? 20 :
                t < 69 ? 30 : 0 | Math.ceil(40 + n)

const getTotalAmountToolsFlank = (e, t) => getTotalAmountTools(0, e, 0 | t)
const getTotalAmountToolsFront = e => getTotalAmountTools(1, e, 0)

const getMaxAttackers = targetLevel =>
    targetLevel <= 69 ? Math.min(260, 5 * targetLevel + 8) : 320
const getAmountSoldiersFlank = (level, multiplier) => 
    Math.ceil(.2 * getMaxAttackers(level) * (1 + (0 | multiplier) / 100))
const getAmountSoldiersFront = (level, multiplier) => 
    Math.ceil((getMaxAttackers(level) - 2 * getAmountSoldiersFlank(level)) * (1 + (0 | multiplier) / 100))
const getMaxUnitsInReinforcementWave = (playerLevel, targetLevel, additionalUnits, additionalUnitsMultiplyer) =>
    Math.round((20 * Math.sqrt(Math.min(playerLevel, 70)) + 50 + 20 * targetLevel + (0 | additionalUnits)) * 
        (1 + (0 | additionalUnitsMultiplyer) / 100))

function getMaxWaveCount(e) {
    const waveUnlockLevelList = [0, 13, 26, 51]
    let n = 1
    for (let i = waveUnlockLevelList.length - 1; i >= 0; i--) {
        if (e < waveUnlockLevelList[i])
            continue
        n = i + 1
        break
    }
    return n
}

function assignUnit(unitSlot, units, maxUnits) {
    let unit = units[0]
    if (!unit)
        return 0

    let unitType = unit[0].wodID
    let unitAmmount = Math.floor(Math.max(Math.min(unit[1], maxUnits),0))

    unit[1] -= unitAmmount

    if (unit[1] <= 0)
        units.shift()

    if (unitAmmount > 0) {
        unitSlot[0] = unitType
        unitSlot[1] = unitAmmount
    }

    return unitAmmount
}
function getAttackInfo(kid, sourceCastle, AI, commander, level, waves, options, additionalWaves) {
    const attackTarget = {
        SX: sourceCastle.x,
        SY: sourceCastle.y,
        TX: AI.x,
        TY: AI.y,
        KID: kid,
        LID: commander.lordID,
        WT: 0,
        HBW: -1,
        BPC: 0,
        ATT: 0,
        AV: 0,
        LP: 0,
        FC: 0,
        PTT: 0,
        SD: 0,
        ICA: 0,
        CD: 99,
        A: [],
        BKS: [],
        AST: [
            -1,
            -1,
            -1
        ],
        RW: [ //TODO: SET THIS UP PROPERLY
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ]
            ],
        ASCT: 0
    }

    
    if (isNaN(waves) || waves <= 0)
        waves = Infinity

    waves = Math.max(Math.min(waves, getMaxWaveCount(playerInfo.level) + (0 | additionalWaves)), 1)

    for (let i = 0; i < waves; i++) {
        const wave = {
            L: {
                T: [],
                U: []
            },
            R: {
                T: [],
                U: []
            },
            M: {
                T: [],
                U: []
            }
        }
        const setupWave = (wallLevelRequirement, row) =>
            wallLevelRequirement.every(e =>
                e <= level ? row.push([-1, 0]) : false)

        setupWave([0, 37], wave.L.T)
        setupWave([0, 13], wave.L.U)
        setupWave([0, 11, 37], wave.M.T)
        setupWave([0, 0, 13, 13, 26, 26], wave.M.U)
        setupWave([0, 37], wave.R.T)
        setupWave([0, 13], wave.R.U)
        attackTarget.A.push(wave)
    }
    const castleData = getPermanentCastle().find(e => e.kingdomID == kid &&
        (kid == 10 || e.areaID == sourceCastle.extraData[0]))
    const unlockedHorses = castleData?.unlockedHorses

    if (options.useCoin && !options.useFeather) {
        let bestHorse = -1
        let minSpeed = Infinity

        unlockedHorses?.forEach(e => {
            let horse = stables.find(a => e == a.wodID)
            if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0) {
                 if (Number(horse.unitBoost) < minSpeed) {
                    minSpeed = Number(horse.unitBoost)
                    bestHorse = e
                }
            }
        })
        
        if (bestHorse != -1) {
            attackTarget.HBW = bestHorse
            attackTarget.PTT = 0
        } else {
            console.debug("noStablesCoinHorse")
            attackTarget.HBW = -1
            attackTarget.PTT = 0
        }
    }
    else {
        attackTarget.HBW = -1
        if(resources.pegasusTicket > 0) {
            attackTarget.PTT = options.useFeather ? 1 : 0
        } else {
            console.warn("Ran out of fast feathers.")
            attackTarget.PTT = 0
        }
    }
    
    return attackTarget
}

function boxMullerRandom(min, max, skew) {
    let u = 0, v = 0
    while(u === 0) u = Math.random()
    while(v === 0) v = Math.random()
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v )

    num = num / 10.0 + 0.5
    if (num > 1 || num < 0) num = boxMullerRandom(min, max, skew)
    num = Math.pow(num, skew)
    num *= max - min
    num += min
    return num
}

const sleep = ms => new Promise(r => setTimeout(r, ms).unref())

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const attacks = []
let alreadyRunning = false
let attackCount = undefined
let attackThreshold = undefined

if([,""].includes(pluginOptions.attackLimit))
    pluginOptions.attackLimit = 3500
    
xtHandler.on("gai", obj => {
    attackCount = obj.AC
    attackThreshold = obj.ACTH
})
let announced = false

const limiter = new RateLimiter({ tokensPerInterval : 60 / (8 / 60) - 8, interval: "hour"})

const waitToAttack = callback => new Promise((resolve, reject) => {
    if(!botConfig.externalEvent && attackCount >= Number(pluginOptions.attackLimit ?? attackThreshold)) {
        if(!announced) {
            announced = true
            console.log("Max attacks reached")
        }
        return reject("ATTACK_LIMIT_REACHED")
    }

    attacks.push(() => {
        try {
            ret = callback()
            resolve(ret)
            return ret
        }
        catch (e) {
            reject(e)
            return true
        }
    })
    
    if (!alreadyRunning) {
        alreadyRunning = true
        setImmediate(async () => {
            do {
                try {
                    const baseDelay = parseInt(pluginOptions.attackDelaySeconds)
                    const variance = parseInt(pluginOptions.attackDelayRandomizationSeconds)
                    const naturalDelay = boxMullerRandom(baseDelay * 1000, (baseDelay + variance) * 1000, 1)

                    console.debug("attackDelayAttack", naturalDelay)
                    
                    if (!await (attacks.shift()()))
                        continue

                    await limiter.removeTokens(1)

                    await sleep(naturalDelay)
                } catch (innerError) {
                    if (innerError !== "NO_MORE_TROOPS") {
                        console.warn("failedToHandleAttack", innerError)
                        console.error(innerError)
                    }
                }
            }
            while (attacks?.length > 0);
            alreadyRunning = false
        })
    }
})

module.exports = {
    getAttackInfo,
    assignUnit,
    waitToAttack,
    getTotalAmountToolsFlank,
    getTotalAmountToolsFront,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    boxMullerRandom
}