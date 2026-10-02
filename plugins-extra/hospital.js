/*
 * Extra plugin: hospital manager.
 * - Monitors hospital unit queues and healing, auto-peeks for unit recoveries.
 * - Requeues movement if needed and handles complex nested payloads.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {}

const { sendXT, waitForResult, xtHandler, events } = require("../ggeBot.js")
const {
    getResourceCastleList,
    kingdomLock
} = require("../protocols.js")

const HOSPITAL_HEAL_CHECK_INTERVAL_MS = 1000 * 60 * 25 // 25 minutes

events.once("load", async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const hospitalBuildingIDs = new Set([
        1, 2, 3, 4, 5, 20, 21, 22, 23, 80,
        308, 309, 311, 312, 463, 464, 465, 466, 467, 468, 1940
    ])

    const normalizeHospitalUnits = inventory => Array.from(inventory ?? [])
        .map(unit => ({
            unitID: Number(unit.unitID),
            amount: Number(unit.ammount ?? 0)
        }))
        .filter(unit => Number.isFinite(unit.unitID) && unit.unitID > 0 && Number.isFinite(unit.amount) && unit.amount > 0)

    const parseUnitCandidate = candidate => {
        if (Array.isArray(candidate)) {
            const unitID = Number(candidate[0])
            const amount = Number(candidate[1] ?? 0)
            if (Number.isFinite(unitID) && unitID > 0 && Number.isFinite(amount) && amount > 0)
                return { unitID, amount }

            return null
        }

        if (!candidate || typeof candidate != "object")
            return null

        const hasUnitKey = candidate.unitID != undefined || candidate.U != undefined
        const hasAmountKey = candidate.ammount != undefined || candidate.amount != undefined || candidate.A != undefined || candidate.AMT != undefined
        if (!hasUnitKey || !hasAmountKey)
            return null

        const unitID = Number(candidate.unitID ?? candidate.U ?? candidate.ID ?? candidate.WID ?? 0)
        const amount = Number(candidate.ammount ?? candidate.amount ?? candidate.A ?? candidate.AMT ?? 0)
        if (Number.isFinite(unitID) && unitID > 0 && Number.isFinite(amount) && amount > 0)
            return { unitID, amount }

        return null
    }

    const findValuesByKey = (root, key, maxDepth = 8) => {
        const result = []
        const stack = [{ value: root, depth: 0 }]

        while (stack.length > 0) {
            const { value, depth } = stack.pop()
            if (value == null || depth > maxDepth)
                continue

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++)
                    stack.push({ value: value[i], depth: depth + 1 })

                continue
            }

            if (typeof value != "object")
                continue

            if (Object.prototype.hasOwnProperty.call(value, key))
                result.push(value[key])

            for (const nested of Object.values(value))
                stack.push({ value: nested, depth: depth + 1 })
        }

        return result
    }

    const collectUnitsFromPayload = payload => {
        const candidates = [
            payload?.grc?.HI,
            payload?.HI,
            payload?.gpa?.HI,
            payload?.grc?.gpa?.HI,
            payload?.gca?.A?.HI,
            ...findValuesByKey(payload, "HI")
        ]

        const unitsByID = new Map()

        const addUnit = unit => {
            if (!unit)
                return

            const currentAmount = Number(unitsByID.get(unit.unitID) ?? 0)
            unitsByID.set(unit.unitID, currentAmount + unit.amount)
        }

        for (let i = 0; i < candidates.length; i++) {
            const list = candidates[i]
            if (!Array.isArray(list))
                continue

            for (let j = 0; j < list.length; j++)
                addUnit(parseUnitCandidate(list[j]))
        }

        const stack = [payload]
        let depthGuard = 0
        while (stack.length > 0 && depthGuard < 20000) {
            depthGuard++
            const value = stack.pop()
            if (!value)
                continue

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++)
                    stack.push(value[i])

                continue
            }

            if (typeof value != "object")
                continue

            addUnit(parseUnitCandidate(value))

            for (const nested of Object.values(value))
                stack.push(nested)
        }

        return Array.from(unitsByID.entries())
            .map(([unitID, amount]) => ({ unitID: Number(unitID), amount: Number(amount) }))
            .filter(unit => Number.isFinite(unit.unitID) && unit.unitID > 0 && Number.isFinite(unit.amount) && unit.amount > 0)
    }

    const waitForResultSilent = (key, timeout, filter) => new Promise(resolve => {
        const listener = (data, result) => {
            if (filter && !filter(data, result))
                return

            cleanup()
            resolve({ received: true, result: Number(result), data })
        }

        const cleanup = () => {
            clearTimeout(timer)
            xtHandler.removeListener(key, listener)
        }

        const timer = setTimeout(() => {
            cleanup()
            resolve({ received: false, result: NaN, data: undefined })
        }, timeout)

        xtHandler.addListener(key, listener)
    })

    const getHospitalState = async (kingdomID, areaID, retries = 2) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                sendXT("jca", JSON.stringify({ CID: areaID, KID: kingdomID }))
                const [joinRaw] = await waitForResult("jaa", 1000 * 10, o =>
                    Number(o?.grc?.KID) == kingdomID && Number(o?.grc?.AID) == areaID)

                let normalizedUnits = collectUnitsFromPayload(joinRaw)
                if (normalizedUnits.length == 0)
                    normalizedUnits = normalizeHospitalUnits(joinRaw?.grc?.gpa?.HI)

                const hasHospitalByFlag = Boolean(joinRaw?.grc?.H)
                const hasHospitalByUnits = normalizedUnits.length > 0
                const hasHospitalByBuilding = Array.from(joinRaw?.gca?.BD ?? [])
                    .some(building => hospitalBuildingIDs.has(Number(building?.[0])))

                const hasHospital = hasHospitalByFlag || hasHospitalByUnits || hasHospitalByBuilding

                if (normalizedUnits.length == 0 && hasHospital) {
                    sendXT("hfl", JSON.stringify({ KID: kingdomID, AID: areaID, HRF: -1 }))
                    const hflResult = await waitForResultSilent("hfl", 1000 * 4, data => {
                        if (!data || typeof data != "object")
                            return true

                        if (data.KID != undefined && Number(data.KID) != kingdomID)
                            return false

                        if (data.AID != undefined && Number(data.AID) != areaID)
                            return false

                        return true
                    })

                    if (hflResult.received)
                        normalizedUnits = collectUnitsFromPayload(hflResult.data)
                }

                return {
                    hasHospital,
                    units: normalizedUnits,
                    unitCount: normalizedUnits.reduce((sum, unit) => sum + unit.amount, 0)
                }
            } catch (error) {
                if (error != "TIMED_OUT" || attempt >= retries)
                    throw error

                await sleep(700)
            }
        }

        return { hasHospital: false, units: [], unitCount: 0 }
    }

    const ensureCastleContext = async (kingdomID, areaID, retries = 2) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                sendXT("jca", JSON.stringify({ CID: areaID, KID: kingdomID }))
                await waitForResult("jaa", 1000 * 10, o =>
                    Number(o?.grc?.KID) == kingdomID && Number(o?.grc?.AID) == areaID)
                return
            } catch (error) {
                if (error != "TIMED_OUT" || attempt >= retries)
                    throw error

                await sleep(500)
            }
        }
    }

    const openHospital = async (kingdomID, areaID) => {
        sendXT("hfl", JSON.stringify({ KID: kingdomID, AID: areaID, HRF: -1 }))
        return await waitForResultSilent("hfl", 1000 * 3, data => {
            if (!data || typeof data != "object")
                return true

            if (data.KID != undefined && Number(data.KID) != kingdomID)
                return false

            if (data.AID != undefined && Number(data.AID) != areaID)
                return false

            return true
        })
    }

    const sendHRU = async (unitID, amount) => {
        sendXT("hru", JSON.stringify({ U: unitID, A: amount }))

        const hruAck = await waitForResultSilent("hru", 1000 * 3, data => {
            if (!data || typeof data != "object")
                return true

            if (data.U != undefined && Number(data.U) != unitID)
                return false

            return true
        })

        if (!hruAck.received)
            return { accepted: true, unverified: true, result: 0 }

        return {
            accepted: hruAck.result == 0,
            unverified: false,
            result: hruAck.result
        }
    }

    const prepareHospitalHealingContext = async (kingdomID, areaID) => {
        await ensureCastleContext(kingdomID, areaID)
        await sleep(220)
        await openHospital(kingdomID, areaID)
        await sleep(160)
    }

    const healHospitalArea = async (kingdomID, areaID, initialState) => {
        const beforeCount = initialState.unitCount
        const unitsToHeal = Array.from(initialState.units)

        await prepareHospitalHealingContext(kingdomID, areaID)
        await openHospital(kingdomID, areaID)

        let sentHRU = 0
        let rejectedHRU = 0

        for (let i = 0; i < unitsToHeal.length; i++) {
            const unit = unitsToHeal[i]
            let remaining = unit.amount

            while (remaining > 0) {
                const chunk = Math.min(remaining, 10)
                const hruResult = await sendHRU(unit.unitID, chunk)

                if (hruResult.accepted) {
                    sentHRU += chunk
                    remaining -= chunk

                    await sleep(120)
                    continue
                }

                // Some sessions lose hospital context mid-loop; refresh once and retry the same chunk.
                await prepareHospitalHealingContext(kingdomID, areaID)
                const retryChunkResult = await sendHRU(unit.unitID, chunk)

                if (retryChunkResult.accepted) {
                    sentHRU += chunk
                    remaining -= chunk

                    await sleep(140)
                    continue
                }

                if (chunk > 1) {
                    const fallbackResult = await sendHRU(unit.unitID, 1)
                    if (fallbackResult.accepted) {
                        sentHRU += 1
                        remaining -= 1

                        await sleep(120)
                        continue
                    }

                    await prepareHospitalHealingContext(kingdomID, areaID)
                    const retryFallbackResult = await sendHRU(unit.unitID, 1)
                    if (retryFallbackResult.accepted) {
                        sentHRU += 1
                        remaining -= 1

                        await sleep(140)
                        continue
                    }
                }

                rejectedHRU++
                break
            }
        }

        await sleep(1200)
        const afterState = await getHospitalState(kingdomID, areaID)
        const afterCount = afterState.unitCount

        if (afterCount < beforeCount)
            return {
                healedCount: beforeCount - afterCount,
                beforeCount,
                afterCount,
                status: "healed"
            }

        if (sentHRU > 0)
            return {
                healedCount: 0,
                beforeCount,
                afterCount,
                status: "acked_unverified"
            }

        if (rejectedHRU > 0)
            return {
                healedCount: 0,
                beforeCount,
                afterCount,
                status: "hru_rejected"
            }

        return {
            healedCount: 0,
            beforeCount,
            afterCount,
            status: "no_change"
        }
    }

    const buildHospitalTargets = async () => {
        const targets = []
        const resourceCastleList = await getResourceCastleList()

        for (let i = 0; i < resourceCastleList.castles.length; i++) {
            const resourceCastle = resourceCastleList.castles[i]

            for (let j = 0; j < resourceCastle.areaInfo.length; j++) {
                const areaInfo = resourceCastle.areaInfo[j]
                const areaID = Number(areaInfo?.extraData?.[0])
                if (!Number.isFinite(areaID) || areaID <= 0)
                    continue

                targets.push({
                    kingdomID: Number(resourceCastle.kingdomID),
                    areaID
                })
            }
        }

        return targets
    }

    const healHospitals = async () => {
        const hospitalTargets = await buildHospitalTargets()
        let unitsHealed = 0
        let healedAny = false
        let hospitalsDetected = 0
        let hospitalsWithUnits = 0
        let hospitalsKnownUnitState = 0
        let hospitalsUnknownUnitState = 0
        let hruRejected = 0
        let healFailed = 0

        for (let i = 0; i < hospitalTargets.length; i++) {
            const target = hospitalTargets[i]

            await kingdomLock(async () => {
                try {
                    const initialState = await getHospitalState(target.kingdomID, target.areaID)
                    if (!initialState.hasHospital)
                        return

                    hospitalsDetected++
                    if (initialState.units.length > 0)
                        hospitalsKnownUnitState++
                    else
                        hospitalsUnknownUnitState++

                    if (initialState.unitCount === 0)
                        return

                    hospitalsWithUnits++

                    const healResult = await healHospitalArea(target.kingdomID, target.areaID, initialState)

                    if (healResult.healedCount > 0) {
                        unitsHealed += healResult.healedCount
                        healedAny = true
                        return
                    }

                    if (healResult.status == "acked_unverified") {
                        healedAny = true
                        return
                    }

                    if (String(healResult.status).startsWith("hru_rejected")) {
                        hruRejected++
                        healFailed++
                        return
                    }

                    if (healResult.status == "no_change") {
                        healFailed++
                        console.warn(
                            "failedToHealHospital",
                            `KID:${target.kingdomID} AID:${target.areaID} before:${healResult.beforeCount} after:${healResult.afterCount}`
                        )
                    }
                } catch (error) {
                    console.warn("healHospitalsError", `KID:${target.kingdomID} AID:${target.areaID}`, error)
                }
            })
        }

        if (unitsHealed > 0)
            console.log(unitsHealed, "unitsHealed")
        else if (healedAny)
            console.log("healAttemptedButCountUnavailable")
        else if (hospitalsWithUnits > 0)
            console.log(healFailed, "failedToHealHospitals")
        else
            console.log("noUnitsToHealInHospital")
    }

    let healHospitalsIsRunning = false
    const runHealHospitals = () => {
        if (healHospitalsIsRunning)
            return

        healHospitalsIsRunning = true
        healHospitals().catch(err => {
            console.error("healHospitals failed:", err)
        }).finally(() => {
            healHospitalsIsRunning = false
        })
    }

    runHealHospitals()
    setInterval(runHealHospitals, HOSPITAL_HEAL_CHECK_INTERVAL_MS)
})
