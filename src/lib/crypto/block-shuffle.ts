// 宫格拼图混淆算法
// 移植自: tool.hadsky.com.html

const DEFAULT_KEY = 'hadsky.com'

function getRnd(key: string, seed: number) {
	let index = seed % key.length
	index = key.charCodeAt(index) % key.length
	const floatNum = parseFloat('0.' + index)
	return Math.floor(floatNum * seed)
}

function shuffleArray(array: any[], seedKey: string, isDecrypt: boolean) {
	const len = array.length
	const userKey = seedKey || ''

    // 辅助函数：执行一轮洗牌
    const performShuffle = (arr: any[], key: string, reverse: boolean) => {
        if (!reverse) {
            for (let i = len - 1; i > 0; i--) {
                const target = getRnd(key, i + 1)
                ;[arr[i], arr[target]] = [arr[target], arr[i]]
            }
        } else {
             for (let i = 0; i < len; i++) {
                const target = getRnd(key, i + 1)
                ;[arr[target], arr[i]] = [arr[i], arr[target]]
            }
        }
    }

	if (!isDecrypt) {
        // 加密：先反转 -> 默认key洗牌 -> 用户key洗牌
		array.reverse()
		performShuffle(array, DEFAULT_KEY, false)
		if (userKey) performShuffle(array, userKey, false)
	} else {
        // 解密：用户key逆洗牌 -> 默认key逆洗牌 -> 反转
		if (userKey) performShuffle(array, userKey, true)
		performShuffle(array, DEFAULT_KEY, true)
		array.reverse()
	}
    
	return array
}

export const BlockShuffleAlgo = {
	process(ctx: CanvasRenderingContext2D, width: number, height: number, level: number, key: string, type: 'encrypt' | 'decrypt') {
		const blockW = Math.floor(width / level)
		const blockH = Math.floor(height / level)

		if (blockW === 0 || blockH === 0) {
			throw new Error('图片尺寸太小或混淆等级太高')
		}

        // 1. 切割
		const blocks: ImageData[] = []
		for (let y = 0; y < level; y++) {
			for (let x = 0; x < level; x++) {
				// 注意：这里可能因为取整导致边缘像素丢失，原算法即如此，暂保持一致
				blocks.push(ctx.getImageData(x * blockW, y * blockH, blockW, blockH))
			}
		}

        // 2. 洗牌/还原
		shuffleArray(blocks, key, type === 'decrypt')

        // 3. 重绘
        // 清空画布
        ctx.clearRect(0, 0, width, height)
		let index = 0
		for (let y = 0; y < level; y++) {
			for (let x = 0; x < level; x++) {
				if (index < blocks.length) {
					ctx.putImageData(blocks[index], x * blockW, y * blockH)
					index++
				}
			}
		}
	}
}