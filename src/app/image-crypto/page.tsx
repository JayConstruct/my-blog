'use client'

import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { DialogModal } from '@/components/dialog-modal'
import { GilbertAlgo } from '@/lib/crypto/gilbert'
import { BlockShuffleAlgo } from '@/lib/crypto/block-shuffle'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { Lock, Unlock, Download, Trash2, ArrowRight, RefreshCw, ArrowLeftRight, RotateCcw, ExternalLink } from 'lucide-react'

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
	usedAlgo?: AlgoType
	lastMode?: 'encrypt' | 'decrypt'
}

type PreviewTarget = {
	index: number
	type: 'original' | 'result'
} | null

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
	const [blockKey, setBlockKey] = useState('tool.hadsky.com')
	const [isProcessing, setIsProcessing] = useState(false)
	
	const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null)
	
	const [isDragging, setIsDragging] = useState(false)
	const dragCounterRef = useRef(0)
	const hasImages = images.length > 0
	const hasProcessed = images.some(item => item.status === 'done')

	// 核心处理逻辑
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

						if (options.algo === 'gilbert') {
							const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
							const resultData = GilbertAlgo.process(imageData, mode)
							ctx.putImageData(resultData, 0, 0)
						} else {
							BlockShuffleAlgo.process(ctx, canvas.width, canvas.height, options.blockLevel, options.blockKey, mode)
						}

						canvas.toBlob(blob => {
							if (blob) {
								const resultUrl = URL.createObjectURL(blob)
								if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
								resolve({
									...item,
									status: 'done',
									resultBlob: blob,
									resultPreview: resultUrl,
									usedAlgo: options.algo,
									lastMode: mode
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

	// 切换算法
	const handleSwitchAlgo = async (index: number) => {
		const item = images[index]
		if (item.status !== 'done' || !item.usedAlgo || !item.lastMode) return
		const nextAlgo: AlgoType = item.usedAlgo === 'gilbert' ? 'block' : 'gilbert'
		setImages(prev => prev.map((p, i) => i === index ? { ...p, status: 'processing' } : p))
		const res = await processImage(item, item.lastMode, { algo: nextAlgo, blockLevel, blockKey })
		setImages(prev => prev.map((p, i) => i === index ? res : p))
		toast.success(`已切换为 ${nextAlgo === 'gilbert' ? '像素混淆' : '宫格拼图'}`)
	}

	// 全部还原
	const handleResetAll = useCallback(() => {
		setImages(prev => prev.map(item => {
			if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
			return {
				...item,
				status: 'idle',
				resultPreview: undefined,
				resultBlob: undefined,
				usedAlgo: undefined,
				lastMode: undefined
			}
		}))
		toast.success('已重置所有图片状态')
	}, [])

	// 文件处理...
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

	const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation(); dragCounterRef.current += 1; setIsDragging(true)
	}, [])
	const handleDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation()
	}, [])
	const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation(); dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
		if (dragCounterRef.current === 0) setIsDragging(false)
	}, [])
	const handleDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault(); event.stopPropagation(); setIsDragging(false); dragCounterRef.current = 0
		handleFiles(event.dataTransfer?.files ?? null)
	}, [handleFiles])

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

	const handleDownload = useCallback((index: number) => {
		const target = images[index]
		if (!target?.resultPreview) return
		const link = document.createElement('a')
		const ext = target.usedAlgo === 'gilbert' ? 'pixel' : 'block'
		const baseName = target.file.name.replace(/\.[^.]+$/, '')
		link.href = target.resultPreview
		link.download = `${baseName}_${ext}.jpg`
		document.body.appendChild(link)
		link.click(); link.remove()
	}, [images])

	const handleDownloadAll = useCallback(async () => {
		const processed = images.filter(i => i.status === 'done' && i.resultBlob)
		if (processed.length === 0) return
		const zip = new JSZip()
		const folder = zip.folder("encrypted_images")
		processed.forEach((item, idx) => {
			const ext = item.usedAlgo === 'gilbert' ? 'pixel' : 'block'
			const name = item.file.name.replace(/\.[^/.]+$/, "")
			folder?.file(`${name}_${ext}_${idx}.jpg`, item.resultBlob!)
		})
		const content = await zip.generateAsync({ type: "blob" })
		const link = document.createElement('a')
		link.href = URL.createObjectURL(content)
		link.download = `secure_box_${Date.now()}.zip`
		link.click(); link.remove()
	}, [images])

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
			<div className='mx-auto flex max-w-5xl flex-col gap-6'>
				
				<motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: INIT_DELAY }} className='space-y-2 text-center'>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Secure Box</p>
					<h1 className='text-2xl font-semibold'>图片本地加解密</h1>
					<p className='text-secondary'>纯前端混淆算法 · 数据不上传服务器</p>
				</motion.div>

				<motion.label
					initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: INIT_DELAY + ANIMATION_DELAY }}
					onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
					className={`group hover:border-brand/20 card relative flex cursor-pointer flex-col items-center justify-center gap-3 text-center transition-colors hover:bg-white/80 ${isDragging ? 'border-brand bg-white' : ''}`}
				>
					<input type='file' accept='image/*' multiple className='hidden' onChange={e => handleFiles(e.target.files)} />
					<div className='bg-brand/10 text-brand/60 group-hover:bg-brand/10 flex h-20 w-20 items-center justify-center rounded-full text-3xl transition'>🔒</div>
					<div><p className='text-base font-medium'>点击或拖拽图片</p><p className='text-secondary text-xs'>支持任意图片格式，处理后导出为 JPG</p></div>
				</motion.label>

				<motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: INIT_DELAY + 2 * ANIMATION_DELAY }} className='card relative'>
					<div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
						<div className='flex-1 space-y-4'>
							<div>
								<p className='text-secondary text-xs tracking-[0.2em] uppercase'>默认算法设置</p>
								<div className='flex flex-wrap items-center gap-3 pt-2'>
									<div className='flex items-center rounded-lg bg-slate-100 p-1'>
										<button onClick={() => setAlgo('gilbert')} className={`rounded-md px-3 py-1 text-xs transition-all ${algo === 'gilbert' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>Gilbert 像素混淆</button>
										<button onClick={() => setAlgo('block')} className={`rounded-md px-3 py-1 text-xs transition-all ${algo === 'block' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>Block 宫格拼图</button>
									</div>
								</div>
								<p className='text-xs text-slate-500 mt-2 min-h-[1.5em] flex items-center flex-wrap gap-1'>
									{algo === 'gilbert' ? (
										<>
											基于 Gilbert 空间填充曲线打乱像素，效果类似噪声。
											<a href="https://xfqtphx.netlify.app/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline hover:text-brand/80 transition-colors ml-1" title="访问原作者工具">
												<ExternalLink className="w-3 h-3" /> 算法来源
											</a>
										</>
									) : (
										<>
											将图片切分为网格并打乱顺序，支持密钥保护。
											<a href="https://tool.hadsky.com/enimg" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline hover:text-brand/80 transition-colors ml-1" title="访问原作者工具">
												<ExternalLink className="w-3 h-3" /> 算法来源
											</a>
										</>
									)}
								</p>
							</div>
							{algo === 'block' && (
								<div className='flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-top-2'>
									<div className='flex items-center gap-2'>
										<label className='text-secondary text-xs tracking-[0.2em] uppercase'>等级</label>
										<input type='number' min={2} max={100} value={blockLevel} onChange={e => setBlockLevel(Number(e.target.value))} className='w-16 rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand outline-none' />
									</div>
									<div className='flex items-center gap-2'>
										<label className='text-secondary text-xs tracking-[0.2em] uppercase'>密钥</label>
										<input type='text' placeholder='默认' value={blockKey} onChange={e => setBlockKey(e.target.value)} className='w-36 rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand outline-none' />
									</div>
								</div>
							)}
						</div>
						
						<div className='flex flex-wrap gap-2 text-sm self-end md:self-auto'>
							<button onClick={handleResetAll} disabled={!hasProcessed || isProcessing} className='rounded-full border border-slate-200 px-4 py-2 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 flex items-center gap-2'>
								<RotateCcw className="w-4 h-4" /> 全部还原
							</button>
							<button onClick={() => handleRunAll('encrypt')} disabled={!hasImages || isProcessing} className='rounded-full border border-slate-200 px-4 py-2 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 flex items-center gap-2'>
								<Lock className="w-4 h-4" /> 全部加密
							</button>
							<button onClick={() => handleRunAll('decrypt')} disabled={!hasImages || isProcessing} className='rounded-full border border-slate-200 px-4 py-2 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 flex items-center gap-2'>
								<Unlock className="w-4 h-4" /> 全部解密
							</button>
							<button onClick={handleDownloadAll} disabled={!hasProcessed} className='border-brand text-brand rounded-full border px-4 py-2 font-semibold transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 flex items-center gap-2'>
								<Download className="w-4 h-4" /> 全部下载
							</button>
						</div>
					</div>
				</motion.div>

				{/* 图片列表 */}
				{hasImages && (
					<motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className='space-y-4'>
						{images.map((item, index) => {
							const { file, preview, status, width, height } = item
							const isDone = status === 'done'
							const isError = status === 'error'
							
							return (
								<motion.div 
									key={item.id} 
									layout 
									// 修改：复用上传区的高亮逻辑 hover:border-brand/20 hover:bg-white/80
									className='card group relative flex flex-col md:flex-row h-auto md:h-64 gap-4 p-4 transition-colors hover:border-brand/20 hover:bg-white/80'
								>
									{/* 左：原图 */}
									<div 
										className='relative flex-1 rounded-2xl border border-slate-100 bg-slate-50/50 overflow-hidden group/img min-h-[200px] cursor-zoom-in' 
										onClick={() => setPreviewTarget({ index, type: 'original' })}
									>
										<span className='absolute left-3 top-3 z-10 rounded-md bg-black/50 px-2 py-1 text-[10px] font-bold text-white backdrop-blur'>原图</span>
										<img src={preview} className='h-full w-full object-cover transition-transform duration-500 group-hover/img:scale-105' alt="Original" />
										{/* 移除了中间的圆形图标遮罩 */}
									</div>

									<div className='hidden md:flex flex-col items-center justify-center text-slate-300 gap-2 w-8 shrink-0'>
										{status === 'processing' ? <RefreshCw className='w-5 h-5 animate-spin text-brand' /> : <ArrowRight className='w-5 h-5' />}
									</div>

									{/* 中：结果图 */}
									<div 
										className={`relative flex-1 rounded-2xl border border-slate-100 bg-slate-100/50 overflow-hidden group/img min-h-[200px] transition-all ${isDone ? 'cursor-zoom-in' : ''}`}
										onClick={() => isDone && setPreviewTarget({ index, type: 'result' })}
									>
										<span className='absolute left-3 top-3 z-10 rounded-md bg-brand/80 px-2 py-1 text-[10px] font-bold text-white backdrop-blur'>结果</span>
										{isDone ? (
											<img src={item.resultPreview} className='h-full w-full object-cover transition-transform duration-500 group-hover/img:scale-105' alt="Result" />
											// 移除了中间的圆形图标遮罩
										) : isError ? (
											<div className='flex h-full w-full items-center justify-center text-rose-400'>处理失败</div>
										) : (
											<div className='flex h-full w-full flex-col items-center justify-center gap-2 text-slate-300'>
												{status === 'processing' ? <><RefreshCw className='w-8 h-8 animate-spin text-brand/50' /><span className='text-xs'>正在处理...</span></> : <><Lock className='w-8 h-8 opacity-20' /><span className='text-xs'>等待操作</span></>}
											</div>
										)}
									</div>

									{/* 右：操作 */}
									<div className='flex w-full md:w-56 flex-col justify-between gap-4 py-2 shrink-0'>
										<div className='space-y-1'>
											<h3 className='font-medium text-slate-900 line-clamp-2 leading-tight' title={file.name}>{file.name}</h3>
											<div className='space-y-0.5 text-xs text-secondary'>
												<p>{width} × {height} px</p>
												<p>{formatBytes(file.size)}</p>
												{isDone && item.usedAlgo && (
													<p className='mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500'>
														{item.usedAlgo === 'gilbert' ? 'Pixel' : 'Block'} Algo
													</p>
												)}
											</div>
										</div>

										<div className='flex flex-col gap-2'>
											{isDone ? (
												<>
													<button onClick={() => handleSwitchAlgo(index)} className='flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/50 py-2 text-xs font-medium text-slate-700 transition hover:bg-white hover:text-brand hover:border-brand/30 active:scale-95'>
														<ArrowLeftRight className='w-3.5 h-3.5' /> 切换算法
													</button>
													<button onClick={() => handleDownload(index)} className='flex w-full items-center justify-center gap-2 rounded-full bg-brand py-2 text-xs font-medium text-white shadow-sm transition hover:opacity-90 active:scale-95'>
														<Download className='w-3.5 h-3.5' /> 下载文件
													</button>
												</>
											) : (
												<div className='grid grid-cols-2 gap-2'>
													<button onClick={() => handleRunSingle(index, 'encrypt')} disabled={status === 'processing'} className='flex w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white/50 py-2 text-xs font-medium text-slate-700 transition hover:bg-white hover:border-brand hover:text-brand active:scale-95 disabled:opacity-50'><Lock className='w-3 h-3' /> 加密</button>
													<button onClick={() => handleRunSingle(index, 'decrypt')} disabled={status === 'processing'} className='flex w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white/50 py-2 text-xs font-medium text-slate-700 transition hover:bg-white hover:border-brand hover:text-brand active:scale-95 disabled:opacity-50'><Unlock className='w-3 h-3' /> 解密</button>
												</div>
											)}
											<button onClick={() => handleRemove(index)} className='flex w-full items-center justify-center gap-2 rounded-full border border-transparent py-2 text-xs font-medium text-slate-400 transition hover:bg-rose-50 hover:text-rose-500'><Trash2 className='w-3.5 h-3.5' /> 移除图片</button>
										</div>
									</div>
								</motion.div>
							)
						})}
					</motion.div>
				)}
			</div>

			{/* 单图放大查看模态框 */}
			{previewTarget !== null && images[previewTarget.index] && (
				<DialogModal open={true} onClose={() => setPreviewTarget(null)} className='w-full max-w-5xl'>
					<div className='flex flex-col items-center p-2 outline-none' onClick={() => setPreviewTarget(null)}>
						<div className='mb-2 text-center'>
							<h3 className='text-lg font-semibold text-slate-800'>
								{previewTarget.type === 'original' ? '原始图片' : '处理结果'}
							</h3>
							<p className='text-xs text-secondary mt-0.5'>
								{previewTarget.type === 'original' 
									? `${images[previewTarget.index].width} × ${images[previewTarget.index].height} px`
									: `文件大小: ${formatBytes(images[previewTarget.index].resultBlob?.size || 0)}`}
							</p>
						</div>
						<div className='relative flex items-center justify-center w-full'>
							<img 
								src={previewTarget.type === 'original' 
									? images[previewTarget.index].preview 
									: images[previewTarget.index].resultPreview
								} 
								alt='Preview' 
								className='max-h-[85vh] max-w-full rounded-lg object-contain shadow-sm' 
							/>
						</div>
						<p className='mt-2 text-xs text-slate-400'>点击任意空白处关闭</p>
					</div>
				</DialogModal>
			)}
		</div>
	)
}