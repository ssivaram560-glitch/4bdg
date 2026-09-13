const BIG_DIGITS = [0, 5, 6, 7, 8, 9];

let history = [];
let currentPrediction = null;

function getPredictionSize(digit) {
    return BIG_DIGITS.includes(Number(digit)) ? "BIG" : "SMALL";
}

function predict(results) {
    if (!Array.isArray(results) || results.length < 3) {
        return {
            pair: null,
            nextDigit: null,
            prediction: null,
            matches: []
        };
    }

    const first = Number(results[results.length - 2]);
    const second = Number(results[results.length - 1]);
    if (!Number.isInteger(first) || !Number.isInteger(second)) {
        return {
            pair: null,
            nextDigit: null,
            prediction: null,
            matches: []
        };
    }

    const pair = `${first}${second}`;
    const matches = [];

    for (let index = 0; index <= results.length - 3; index++) {
        if (Number(results[index]) !== first || Number(results[index + 1]) !== second) continue;

        const nextDigit = Number(results[index + 2]);
        if (!Number.isInteger(nextDigit) || nextDigit < 0 || nextDigit > 9) continue;

        matches.push({ index, pair, nextDigit });
        break;
    }

    const nextDigit = matches.length ? matches[0].nextDigit : null;
    return {
        pair,
        nextDigit,
        prediction: nextDigit === null ? null : getPredictionSize(nextDigit),
        matches
    };
}

function addNewResult(newDigit) {
    newDigit = Number(newDigit);

    if (!Number.isInteger(newDigit) || newDigit < 0 || newDigit > 9) {
        return null;
    }

    let result = null;
    if (history.length >= 3 && currentPrediction) {
        const actualSize = getPredictionSize(newDigit);
        result = {
            oldPrediction: currentPrediction,
            actualDigit: newDigit,
            actualSize,
            result: currentPrediction === actualSize ? "WIN" : "LOSS"
        };
    }

    history.push(newDigit);

    const prediction = predict(history);
    currentPrediction = prediction.prediction;

    return {
        ...prediction,
        result
    };
}

function reset() {
    history = [];
    currentPrediction = null;
}

function getState() {
    return {
        history: [...history],
        currentPrediction
    };
}

module.exports = {
    BIG_DIGITS,
    predict,
    addNewResult,
    getPredictionSize,
    getState,
    reset
};
