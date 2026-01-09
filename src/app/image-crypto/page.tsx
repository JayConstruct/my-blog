'use client'

import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { DialogModal } from '@/components/dialog-modal' // 复用你项目已有的组件
import { GilbertAlgo } from '@/lib/crypto/gilbert'
import { BlockShuffleAlgo } from '@/lib/crypto/block-shuffle'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { Lock, Unlock, RefreshCw } from 'lucide-react' // 使用 Lucide 图标更精致，或者换回 Emoji 🔒

// --- 类型定义 ---
type AlgoType = 'gilbert' | 'block'

interface ProcessingOptions {
	algo: AlgoType
	blockLevel: number
	blockKey: string
}

interface ImageItem {
	id: string
	file: File
	preview: string
	width: number
	height: number
	resultPreview?: string
	resultBlob?: Blob
	status: 'idle' | 'processing' | 'done' | 'error'
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes.toFixed(0)} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function Page() {
	// 状态
	const [images, setImages] = useState<ImageItem[]>([])
	const [algo, setAlgo] = useState<AlgoType>('gilbert')
	const [blockLevel, setBlockLevel] = useState(40)
	const [blockKey, setBlockKey] = useState('')
	const [isProcessing, setIsProcessing] = useState(false)
	const [compareIndex, setCompareIndex] = useState<number | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	
	const dragCounterRef = useRef(0)
	const hasImages = images.length > 0
	const hasProcessed = images.some(item => item.status === 'done')

	// 核心处理逻辑 (Promise 封装)
	const processImage = async (item: ImageItem, mode: 'encrypt' | 'decrypt', options: ProcessingOptions) => {
		return new Promise<ImageItem>((resolve) => {
			setTimeout(() => {
				try {
					const canvas = document.createElement('canvas')
					const ctx = canvas.getContext('2d', { willReadFrequently: true })
					if (!ctx) throw new Error('Canvas init failed')

					const img = new Image()
					img.src = item.preview
					
					img.onload = () => {
						canvas.width = img.width
						canvas.height = img.height
						ctx.drawImage(img, 0, 0)

						// 执行算法
						if (options.algo === 'gilbert') {
							const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
							const resultData = GilbertAlgo.process(imageData, mode)
							ctx.putImageData(resultData, 0, 0)
						} else {
							BlockShuffleAlgo.process(ctx, canvas.width, canvas.height, options.blockLevel, options.blockKey, mode)
						}

						// 导出结果 (使用 JPEG 0.95 以减小体积，混淆图对压缩不敏感)
						canvas.toBlob(blob => {
							if (blob) {
								const resultUrl = URL.createObjectURL(blob)
								// 如果有旧的 resultPreview，释放它
								if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
								
								resolve({
									...item,
									status: 'done',
									resultBlob: blob,
									resultPreview: resultUrl
								})
							} else {
								resolve({ ...item, status: 'error' })
							}
						}, 'image/jpeg', 0.95)
					}
					
					img.onerror = () => resolve({ ...item, status: 'error' })
				} catch (e) {
					console.error(e)
					resolve({ ...item, status: 'error' })
				}
			}, 50)
		})
	}

	// 批量处理
	const handleRunAll = async (mode: 'encrypt' | 'decrypt') => {
		if (!hasImages || isProcessing) return
		setIsProcessing(true)

		const options: ProcessingOptions = { algo, blockLevel, blockKey }
		const queue = [...images]
		
		// 串行处理避免卡顿
		const results = []
		for (const item of queue) {
			setImages(prev => prev.map(p => p.id === item.id ? { ...p, status: 'processing' } : p))
			const res = await processImage(item, mode, options)
			results.push(res)
			setImages(prev => prev.map(p => p.id === item.id ? res : p))
		}

		setIsProcessing(false)
		toast.success(mode === 'encrypt' ? '全部加密完成' : '全部解密完成')
	}

	// 单个处理
	const handleRunSingle = async (index: number, mode: 'encrypt' | 'decrypt') => {
		const item = images[index]
		if (item.status === 'processing') return
		
		setImages(prev => prev.map((p, i) => i === index ? { ...p, status: 'processing' } : p))
		const res = await processImage(item, mode, { algo, blockLevel, blockKey })
		setImages(prev => prev.map((p, i) => i === index ? res : p))
	}

	// 文件选择
	const handleFiles = useCallback(async (fileList: FileList | null) => {
		if (!fileList?.length) return
		const files = Array.from(fileList).filter(file => file.type.startsWith('image/'))
		if (!files.length) return

		const nextItems = await Promise.all(
			files.map(async file => {
				const preview = URL.createObjectURL(file)
				const bitmap = await createImageBitmap(file)
				return {
					id: Math.random().toString(36).slice(2),
					file,
					preview,
					width: bitmap.width,
					height: bitmap.height,
					status: 'idle'
				} as ImageItem
			})
		)

		setImages(prev => [...prev, ...nextItems])
	}, [])

	// 拖拽逻辑 (与 Image Toolbox 保持一致)
	const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation()
		dragCounterRef.current += 1
		setIsDragging(true)
	}, [])
	const handleDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation()
	}, [])
	const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation()
		dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
		if (dragCounterRef.current === 0) setIsDragging(false)
	}, [])
	const handleDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation()
		setIsDragging(false); dragCounterRef.current = 0
		handleFiles(event.dataTransfer?.files ?? null)
	}, [handleFiles])

	// 移除
	const handleRemove = useCallback((index: number) => {
		setImages(prev => {
			const next = [...prev]
			const removed = next.splice(index, 1)[0]
			if (removed) {
				URL.revokeObjectURL(removed.preview)
				if (removed.resultPreview) URL.revokeObjectURL(removed.resultPreview)
			}
			return next
		})
	}, [])

	// 下载单个
	const handleDownload = useCallback((index: number) => {
		const target = images[index]
		if (!target?.resultPreview) return
		const link = document.createElement('a')
		const ext = algo === 'gilbert' ? 'pixel' : 'block'
		const baseName = target.file.name.replace(/\.[^.]+$/, '')
		link.href = target.resultPreview
		link.download = `${baseName}_${ext}.jpg`
		document.body.appendChild(link)
		link.click()
		link.remove()
	}, [images, algo])

	// 批量下载
	const handleDownloadAll = useCallback(async () => {
		const processed = images.filter(i => i.status === 'done' && i.resultBlob)
		if (processed.length === 0) return

		const zip = new JSZip()
		const folder = zip.folder("encrypted_images")
		
		processed.forEach((item, idx) => {
			const ext = algo === 'gilbert' ? 'pixel' : 'block'
			const name = item.file.name.replace(/\.[^/.]+$/, "")
			folder?.file(`${name}_${ext}_${idx}.jpg`, item.resultBlob!)
		})

		const content = await zip.generateAsync({ type: "blob" })
		const link = document.createElement('a')
		link.href = URL.createObjectURL(content)
		link.download = `secure_box_${Date.now()}.zip`
		link.click()
		link.remove()
	}, [images, algo])

	// 清理内存
	useEffect(() => {
		return () => {
			images.forEach(item => {
				URL.revokeObjectURL(item.preview)
				if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
			})
		}
	}, [])

	return (
		<div className='relative px-6 pt-32 pb-12 text-sm max-sm:pt-28'>
			<div className='mx-auto flex max-w-3xl flex-col gap-6'>
				
				{/* --- 1. 标题区 --- */}
				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY }}
					className='space-y-2 text-center'>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Secure Box</p>
					<h1 className='text-2xl font-semibold'>图片本地加解密</h1>
					<p className='text-secondary'>纯前端混淆算法 · 数据不上传服务器</p>
				</motion.div>

				{/* --- 2. 拖拽上传卡片 --- */}
				<motion.label
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + ANIMATION_DELAY }}
					onDragEnter={handleDragEnter}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					className={`group hover:border-brand/20 card relative flex cursor-pointer flex-col items-center justify-center gap-3 text-center transition-colors hover:bg-white/80 ${
						isDragging ? 'border-brand bg-white' : ''
					}`}>
					<input type='file' accept='image/*' multiple className='hidden' onChange={e => handleFiles(e.target.files)} />
					<div className='bg-brand/10 text-brand/60 group-hover:bg-brand/10 flex h-20 w-20 items-center justify-center rounded-full text-3xl transition'>
						🔒
					</div>
					<div>
						<p className='text-base font-medium'>点击或拖拽图片</p>
						<p className='text-secondary text-xs'>支持任意图片格式，处理后导出为 JPG</p>
					</div>
				</motion.label>

				{/* --- 3. 图片列表 --- */}
				{hasImages && (
					<motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className='card relative'>
						<div className='text-secondary flex items-center justify-between border-b border-slate-200 pb-3 text-xs tracking-[0.2em] uppercase'>
							<span>已选择 {images.length} 张图片</span>
							<span>{images.some(i => i.status === 'processing') ? '处理中...' : '就绪'}</span>
						</div>
						<ul className='divide-y divide-slate-200'>
							{images.map((item, index) => {
								const { file, preview, status, width, height } = item
								const isDone = status === 'done'
								return (
									<li key={item.id} className='flex items-center gap-4 py-3'>
										{/* 缩略图 */}
										<div className='h-12 w-12 overflow-hidden rounded-xl border border-slate-200 bg-slate-50'>
											<img src={isDone ? item.resultPreview : preview} alt={file.name} className='h-full w-full object-cover' />
										</div>
										
										{/* 信息 */}
										<div className='flex flex-1 flex-col truncate'>
											<p className='font-medium truncate'>{file.name}</p>
											<p className='text-secondary text-xs'>
												{width} × {height} · {formatBytes(file.size)}
												{isDone && <span className='text-emerald-500 ml-2'>✓ 已完成</span>}
											</p>
										</div>

										{/* 操作按钮 */}
										<div className='flex flex-wrap justify-end gap-2 text-xs'>
											{isDone ? (
												<>
													<button onClick={() => setCompareIndex(index)} className='border-brand text-brand hover:bg-brand/10 rounded-full border px-3 py-1 font-semibold transition'>
														对比
													</button>
													<button onClick={() => handleDownload(index)} className='border-brand text-brand hover:bg-brand/10 rounded-full border px-3 py-1 font-semibold transition'>
														下载
													</button>
												</>
											) : (
												<>
													<button onClick={() => handleRunSingle(index, 'encrypt')} disabled={status === 'processing'} className='rounded-full border border-slate-200 px-3 py-1 font-medium transition hover:bg-slate-50 disabled:opacity-50'>
														{status === 'processing' ? '...' : '加密'}
													</button>
													<button onClick={() => handleRunSingle(index, 'decrypt')} disabled={status === 'processing'} className='rounded-full border border-slate-200 px-3 py-1 font-medium transition hover:bg-slate-50 disabled:opacity-50'>
														解密
													</button>
												</>
											)}
											<button onClick={() => handleRemove(index)} className='rounded-full border border-red-200 px-3 py-1 font-medium text-rose-400 transition hover:bg-rose-50'>
												移除
											</button>
										</div>
									</li>
								)
							})}
						</ul>
					</motion.div>
				)}

				{/* --- 4. 底部设置与全局操作 (模仿 Image Toolbox 的 Quality 卡片) --- */}
				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + 2 * ANIMATION_DELAY }}
					className='card relative'>
					
					<div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
						{/* 设置区域 */}
						<div className='flex-1 space-y-4'>
							<div>
								<p className='text-secondary text-xs tracking-[0.2em] uppercase'>算法设置</p>
								<div className='flex flex-wrap items-center gap-3 pt-2'>
									{/* 算法切换 */}
									<div className='flex items-center rounded-lg bg-slate-100 p-1'>
										<button onClick={() => setAlgo('gilbert')} className={`rounded-md px-3 py-1 text-xs transition-all ${algo === 'gilbert' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
											Gilbert 像素混淆
										</button>
										<button onClick={() => setAlgo('block')} className={`rounded-md px-3 py-1 text-xs transition-all ${algo === 'block' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
											Block 宫格拼图
										</button>
									</div>
								</div>
								<p className='text-xs text-slate-500 mt-2'>
									{algo === 'gilbert' ? '基于 Gilbert 空间填充曲线打乱像素，视觉效果类似噪声。' : '将图片切分为网格并打乱顺序，支持密钥保护。'}
								</p>
							</div>

							{/* Block 模式下的额外参数 */}
							{algo === 'block' && (
								<div className='flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-top-2'>
									<div className='flex items-center gap-2'>
										<label className='text-secondary text-xs tracking-[0.2em] uppercase'>等级</label>
										<input 
											type='number' min={2} max={100} value={blockLevel} 
											onChange={e => setBlockLevel(Number(e.target.value))}
											className='w-16 rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand'
										/>
									</div>
									<div className='flex items-center gap-2'>
										<label className='text-secondary text-xs tracking-[0.2em] uppercase'>密钥</label>
										<input 
											type='text' placeholder='默认' value={blockKey} 
											onChange={e => setBlockKey(e.target.value)}
											className='w-24 rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand'
										/>
									</div>
								</div>
							)}
						</div>

						{/* 全局操作按钮 */}
						<div className='flex flex-wrap gap-2 text-sm self-end md:self-auto'>
							<button
								onClick={() => handleRunAll('encrypt')}
								disabled={!hasImages || isProcessing}
								className='rounded-full border border-slate-200 px-4 py-2 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 flex items-center gap-2'>
								<Lock className="w-4 h-4" /> 全部加密
							</button>
							<button
								onClick={() => handleRunAll('decrypt')}
								disabled={!hasImages || isProcessing}
								className='rounded-full border border-slate-200 px-4 py-2 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 flex items-center gap-2'>
								<Unlock className="w-4 h-4" /> 全部解密
							</button>
							<button
								onClick={handleDownloadAll}
								disabled={!hasProcessed}
								className='border-brand text-brand rounded-full border px-4 py-2 font-semibold transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300'>
								全部下载
							</button>
						</div>
					</div>
				</motion.div>
			</div>

			{/* --- 5. 对比模态框 (完全复用 Image Toolbox) --- */}
			{compareIndex !== null && images[compareIndex]?.resultPreview && (
				<DialogModal open={true} onClose={() => setCompareIndex(null)} className='w-full'>
					<div className='grid w-full grid-cols-2 gap-4' onClick={() => setCompareIndex(null)}>
						<div className='flex flex-col items-end p-4'>
							<div>
								<div className='text-secondary text-center text-sm font-medium'>原图</div>
								<img src={images[compareIndex].preview} alt='Original' className='mt-3 max-h-[80vh] rounded-xl bg-slate-100 object-contain' />
							</div>
						</div>
						<div className='flex flex-col items-start p-4'>
							<div>
								<div className='text-secondary text-center text-sm font-medium'>结果 ({formatBytes(images[compareIndex].resultBlob?.size || 0)})</div>
								<img src={images[compareIndex].resultPreview} alt='Result' className='mt-3 max-h-[80vh] rounded-xl bg-slate-100 object-contain' />
							</div>
						</div>
					</div>
				</DialogModal>
			)}
		</div>
	)
}