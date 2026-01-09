// Gilbert 曲线像素混淆算法
// 移植自: 2.html

export const GilbertAlgo = {
	gilbert2d(width: number, height: number) {
		const coordinates: [number, number][] = []
		if (width >= height) this.generate2d(0, 0, width, 0, 0, height, coordinates)
		else this.generate2d(0, 0, 0, height, width, 0, coordinates)
		return coordinates
	},

	generate2d(x: number, y: number, ax: number, ay: number, bx: number, by: number, coordinates: [number, number][]) {
		const w = Math.abs(ax + ay)
		const h = Math.abs(bx + by)
		const dax = Math.sign(ax)
		const day = Math.sign(ay)
		const dbx = Math.sign(bx)
		const dby = Math.sign(by)

		if (h === 1) {
			for (let i = 0; i < w; i++) {
				coordinates.push([x, y])
				x += dax
				y += day
			}
			return
		}
		if (w === 1) {
			for (let i = 0; i < h; i++) {
				coordinates.push([x, y])
				x += dbx
				y += dby
			}
			return
		}

		let ax2 = Math.floor(ax / 2)
		let ay2 = Math.floor(ay / 2)
		let bx2 = Math.floor(bx / 2)
		let by2 = Math.floor(by / 2)

		const w2 = Math.abs(ax2 + ay2)
		const h2 = Math.abs(bx2 + by2)

		if (2 * w > 3 * h) {
			if (w2 % 2 && w > 2) {
				ax2 += dax
				ay2 += day
			}
			this.generate2d(x, y, ax2, ay2, bx, by, coordinates)
			this.generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, coordinates)
		} else {
			if (h2 % 2 && h > 2) {
				bx2 += dbx
				by2 += dby
			}
			this.generate2d(x, y, bx2, by2, ax2, ay2, coordinates)
			this.generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, coordinates)
			this.generate2d(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby), -bx2, -by2, -(ax - ax2), -(ay - ay2), coordinates)
		}
	},

	process(imgData: ImageData, type: 'encrypt' | 'decrypt') {
		const width = imgData.width
		const height = imgData.height
		const newImgData = new ImageData(new Uint8ClampedArray(imgData.data), width, height)
		const curve = this.gilbert2d(width, height)
		const offset = Math.round(((Math.sqrt(5) - 1) / 2) * width * height)
		const totalPixels = width * height

		for (let i = 0; i < totalPixels; i++) {
			const old_pos = curve[i]
			const new_pos = curve[(i + offset) % totalPixels]
			
			const old_p = 4 * (old_pos[0] + old_pos[1] * width)
			const new_p = 4 * (new_pos[0] + new_pos[1] * width)

			if (type === 'encrypt') {
				// 复制 4 个通道 (R, G, B, A)
				for (let c = 0; c < 4; c++) {
					newImgData.data[new_p + c] = imgData.data[old_p + c]
				}
			} else {
				for (let c = 0; c < 4; c++) {
					newImgData.data[old_p + c] = imgData.data[new_p + c]
				}
			}
		}
		return newImgData
	}
}