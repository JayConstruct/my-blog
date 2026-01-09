'use client'

import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { GilbertAlgo } from '@/lib/crypto/gilbert'
import { BlockShuffleAlgo } from '@/lib/crypto/block-shuffle'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { Download, Lock, Unlock, Plus, Trash2, Settings2, RefreshCw, Image as ImageIcon } from 'lucide-react'

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
	resultPreview?: string
	resultBlob?: Blob
	status: 'idle' | 'processing' | 'done' | 'error'
}

export default function Page() {
	// 全局状态
	const [images, setImages] = useState<ImageItem[]>([])
	const [dragActive, setDragActive] = useState(false)
	
	// 算法配置
	const [algo, setAlgo] = useState<AlgoType>('gilbert')
	const [blockLevel, setBlockLevel] = useState(40)
	const [blockKey, setBlockKey] = useState('')
	const [isProcessing, setIsProcessing] = useState(false)

	// 右键菜单状态
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null)

	// 关闭右键菜单
	useEffect(() => {
		const handleClick = () => setContextMenu(null)
		window.addEventListener('click', handleClick)
		return () => window.removeEventListener('click', handleClick)
	}, [])

	// 处理文件上传
	const handleFiles = useCallback((fileList: FileList | null) => {
		if (!fileList?.length) return
		const newImages: ImageItem[] = Array.from(fileList).map(file => ({
			id: Math.random().toString(36).slice(2),
			file,
			preview: URL.createObjectURL(file),
			status: 'idle'
		}))
		setImages(prev => [...prev, ...newImages])
	}, [])

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

						// 执行算法
						if (options.algo === 'gilbert') {
							const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
							const resultData = GilbertAlgo.process(imageData, mode)
							ctx.putImageData(resultData, 0, 0)
						} else {
							BlockShuffleAlgo.process(ctx, canvas.width, canvas.height, options.blockLevel, options.blockKey, mode)
						}

						// 导出结果
						canvas.toBlob(blob => {
							if (blob) {
								resolve({
									...item,
									status: 'done',
									resultBlob: blob,
									resultPreview: URL.createObjectURL(blob)
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

	// 批量执行
	const handleRun = async (mode: 'encrypt' | 'decrypt') => {
		if (images.length === 0) return
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
		toast.success(mode === 'encrypt' ? '加密完成' : '解密完成')
	}

	// 单个操作：还原/重制/删除
	const handleResetItem = (id: string) => {
		setImages(prev => prev.map(item => {
			if (item.id !== id) return item
			if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
			return { ...item, status: 'idle', resultPreview: undefined, resultBlob: undefined }
		}))
	}

	const handleRemoveItem = (id: string) => {
		setImages(prev => {
			const target = prev.find(p => p.id === id)
			if (target?.preview) URL.revokeObjectURL(target.preview)
			if (target?.resultPreview) URL.revokeObjectURL(target.resultPreview)
			return prev.filter(p => p.id !== id)
		})
	}

    const handleReprocessSingle = async (id: string, mode: 'encrypt' | 'decrypt') => {
        const target = images.find(p => p.id === id)
        if (!target) return
        setImages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing' } : p))
        const res = await processImage(target, mode, { algo, blockLevel, blockKey })
        setImages(prev => prev.map(p => p.id === id ? res : p))
    }

	// 打包下载
	const handleDownloadAll = async () => {
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
	}

	// 拖拽事件
	const onDrag = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }
	const onDragEnter = (e: DragEvent) => { onDrag(e); setDragActive(true); }
	const onDragLeave = (e: DragEvent) => { onDrag(e); setDragActive(false); }
	const onDrop = (e: DragEvent) => { onDrag(e); setDragActive(false); handleFiles(e.dataTransfer.files); }

	const isSingleMode = images.length === 1

	return (
		<div className='relative min-h-screen bg-[#F8F9FA] pb-20 pt-20' onDragEnter={onDragEnter} onDragOver={onDrag} onDragLeave={onDragLeave} onDrop={onDrop}>
			
			{/* --- 1. 吸顶标题栏 (Sticky Header) --- */}
            {/* 核心改动：使用 sticky top-0 + z-index 确保浮在图片上方 */}
			<div className='sticky top-0 z-40 border-b border-slate-200 bg-white/80 px-6 py-3 backdrop-blur-md transition-all'>
				<div className='mx-auto flex max-w-7xl items-center justify-between gap-4'>
					<div className='flex items-center gap-3'>
                        {/* 标题 */}
						<h1 className='text-lg font-bold tracking-tight text-slate-800'>Secure Box</h1>
                        <span className='hidden h-4 w-px bg-slate-200 sm:block'></span>
                        <p className='hidden text-xs font-medium text-slate-500 sm:block'>本地图片隐私保护工具</p>
                        
                        {/* 状态指示器 */}
                        {images.length > 0 && (
                            <span className='ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600'>
                                {images.length} {images.length > 1 ? 'images' : 'image'}
                            </span>
                        )}
					</div>

					{/* 核心操作按钮组 (位于标题右侧，永远可见) */}
					<div className='flex items-center gap-2'>
						<button 
                            onClick={() => handleRun('encrypt')} 
                            disabled={isProcessing || !images.length} 
                            className='flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 hover:shadow disabled:opacity-50 disabled:shadow-none'
                        >
                            {isProcessing ? <RefreshCw className="h-3.5 w-3.5 animate-spin"/> : <Lock className="h-3.5 w-3.5"/>}
							加密
						</button>
						<button 
                            onClick={() => handleRun('decrypt')} 
                            disabled={isProcessing || !images.length} 
                            className='flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50'
                        >
                            {isProcessing ? <RefreshCw className="h-3.5 w-3.5 animate-spin"/> : <Unlock className="h-3.5 w-3.5"/>}
							解密
						</button>
                        
                        {/* 只要有一张处理完成，就显示下载按钮 */}
                        {images.some(i => i.status === 'done') && (
                            <div className="ml-1 h-6 w-px bg-slate-200 mx-1"></div>
                        )}
                        {images.some(i => i.status === 'done') && (
                            <button 
                                onClick={handleDownloadAll} 
                                className='flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700'
                            >
                                <Download className="h-3.5 w-3.5"/>
                                <span className="hidden sm:inline">打包下载</span>
                            </button>
                        )}
					</div>
				</div>
			</div>

            {/* --- 2. 配置工具栏 (Settings Toolbar) --- */}
			<div className='mx-auto mt-6 max-w-7xl px-6'>
                <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }}
                    className='flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-2 shadow-sm'
                >
                    {/* 左侧：参数设置 */}
					<div className='flex flex-wrap items-center gap-4 px-2'>
                        {/* 算法切换 */}
						<div className='flex items-center rounded-lg bg-slate-100 p-1'>
							<button onClick={() => setAlgo('gilbert')} className={`rounded-md px-3 py-1.5 text-xs transition-all ${algo === 'gilbert' ? 'bg-white font-medium shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
								像素混淆 (Gilbert)
							</button>
							<button onClick={() => setAlgo('block')} className={`rounded-md px-3 py-1.5 text-xs transition-all ${algo === 'block' ? 'bg-white font-medium shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
								宫格拼图 (Block)
							</button>
						</div>

                        <div className="h-6 w-px bg-slate-100"></div>

						{/* 参数输入 - 仅在 block 模式显示 */}
						{algo === 'block' ? (
							<div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
								<div className='flex items-center gap-2' title="混淆密度 (等级越高块越小)">
                                    <Settings2 className="h-3.5 w-3.5 text-slate-400"/>
									<span className='text-xs font-medium text-slate-500'>等级:</span>
									<input 
                                        type="number" min={2} max={200} 
                                        value={blockLevel} onChange={e => setBlockLevel(Number(e.target.value))} 
                                        className='w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs focus:border-blue-500 focus:outline-none' 
                                    />
								</div>
                                <div className='flex items-center gap-2'>
									<span className='text-xs font-medium text-slate-500'>密钥:</span>
									<input 
                                        type="text" placeholder="默认" 
                                        value={blockKey} onChange={e => setBlockKey(e.target.value)} 
                                        className='w-32 rounded border border-slate-200 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none' 
                                    />
								</div>
							</div>
						) : (
                            <span className="text-xs text-slate-400 flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                无需参数，基于数学曲线混淆
                            </span>
                        )}
					</div>
					
					{/* 右侧：文件操作 */}
					<div className='flex items-center gap-2 px-2'>
                        <label className='cursor-pointer flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-colors'>
                            <Plus className="h-3.5 w-3.5"/>
                            <span>添加图片</span>
                            <input type='file' accept='image/*' multiple className='hidden' onChange={e => handleFiles(e.target.files)} />
                        </label>
                        {images.length > 0 && (
                            <button onClick={() => setImages([])} className='flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 transition-colors'>
                                <Trash2 className="h-3.5 w-3.5"/>
                                清空
                            </button>
                        )}
					</div>
				</motion.div>
			</div>

			{/* --- 3. 图片展示区 (Content) --- */}
			<div className='mx-auto mt-6 max-w-7xl px-6'>
				{!images.length ? (
                    // 空状态
					<motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 ${dragActive ? 'border-blue-500 bg-blue-50 scale-[1.02]' : 'border-slate-200 bg-white/50'}`}
                    >
                        <div className="rounded-full bg-slate-100 p-4 mb-4">
                            <ImageIcon className="h-8 w-8 text-slate-400"/>
                        </div>
						<p className='text-sm font-medium text-slate-600'>点击上方“添加图片”或直接拖拽文件到这里</p>
                        <p className='text-xs text-slate-400 mt-2'>支持 JPG, PNG, WebP 等格式</p>
					</motion.div>
				) : isSingleMode ? (
					// 单图模式 (左右对比)
					<motion.div layout className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                        {/* 左：原图 */}
						<div className='card flex flex-col gap-3 p-4'>
                            <div className="flex items-center justify-between">
							    <span className='text-xs font-bold uppercase tracking-wider text-slate-400'>Original</span>
                                <span className='text-xs text-slate-400'>{images[0].file.name}</span>
                            </div>
							<div className="relative h-[60vh] w-full rounded-lg bg-slate-100/50 border border-slate-100 flex items-center justify-center overflow-hidden">
                                <img src={images[0].preview} className='max-h-full max-w-full object-contain' alt="Original" />
                            </div>
						</div>

                        {/* 右：结果图 */}
						<div 
                            className={`card flex flex-col gap-3 p-4 relative transition-colors ${images[0].status === 'done' ? 'ring-2 ring-blue-500/20' : ''}`}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                if(images[0].status === 'done') setContextMenu({ x: e.clientX, y: e.clientY, targetId: images[0].id })
                            }}
                        >
                            <div className="flex items-center justify-between">
							    <span className='text-xs font-bold uppercase tracking-wider text-slate-400'>Result Preview</span>
                                {images[0].status === 'done' && <span className='text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium'>已完成</span>}
                            </div>
							
                            <div className="relative h-[60vh] w-full rounded-lg bg-slate-100/50 border border-slate-100 flex items-center justify-center overflow-hidden group cursor-context-menu">
                                {images[0].status === 'done' ? (
                                    <img src={images[0].resultPreview} className='max-h-full max-w-full object-contain' alt="Result" />
                                ) : images[0].status === 'processing' ? (
                                    <div className='flex flex-col items-center gap-3 text-slate-400'>
                                        <RefreshCw className="h-8 w-8 animate-spin text-blue-500"/>
                                        <span className="text-xs">Processing...</span>
                                    </div>
                                ) : (
                                    <div className='flex flex-col items-center gap-2 text-slate-300'>
                                        <Lock className="h-8 w-8"/>
                                        <span className="text-xs">等待操作</span>
                                    </div>
                                )}
                                
                                {/* 右键提示遮罩 */}
                                {images[0].status === 'done' && (
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-end justify-end p-4">
                                        <span className="bg-white/90 backdrop-blur text-[10px] text-slate-500 px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                            右键更多选项
                                        </span>
                                    </div>
                                )}
                            </div>
						</div>
					</motion.div>
				) : (
					// 多图模式 (网格列表)
					<motion.div layout className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						<AnimatePresence>
							{images.map(item => (
								<motion.div
									key={item.id}
									layout
									initial={{ opacity: 0, scale: 0.9 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.9 }}
									className='card group relative overflow-hidden p-3 hover:shadow-md transition-shadow'
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        if(item.status === 'done') setContextMenu({ x: e.clientX, y: e.clientY, targetId: item.id })
                                    }}
								>
									<div className='flex gap-2 h-48'>
                                        {/* 原图 */}
										<div className='relative flex-1 bg-slate-50 rounded-lg overflow-hidden border border-slate-100'>
                                            <img src={item.preview} className='h-full w-full object-cover' />
                                            <div className="absolute top-2 left-2 text-[10px] font-medium bg-black/60 backdrop-blur text-white px-1.5 py-0.5 rounded">Original</div>
                                        </div>
                                        {/* 结果图 */}
										<div className='relative flex-1 bg-slate-100 rounded-lg overflow-hidden border border-slate-100 flex items-center justify-center'>
											{item.status === 'done' ? (
												<img src={item.resultPreview} className='h-full w-full object-cover' />
											) : item.status === 'processing' ? (
												<RefreshCw className='animate-spin h-6 w-6 text-slate-400'/>
											) : (
												<span className='text-xs text-slate-300'>Wait</span>
											)}
                                            {item.status === 'done' && <div className="absolute top-2 right-2 text-[10px] font-medium bg-blue-600 text-white px-1.5 py-0.5 rounded shadow-sm">Result</div>}
										</div>
									</div>
                                    <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-2">
                                        <p className="text-xs font-medium text-slate-600 truncate max-w-[150px]" title={item.file.name}>{item.file.name}</p>
                                        <button onClick={() => handleRemoveItem(item.id)} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                                            <Trash2 className="h-3.5 w-3.5"/>
                                        </button>
                                    </div>
								</motion.div>
							))}
						</AnimatePresence>
					</motion.div>
				)}
			</div>

			{/* --- 自定义右键菜单 --- */}
			{contextMenu && (
				<div
					className='fixed z-50 min-w-[140px] overflow-hidden rounded-xl border border-slate-100 bg-white/90 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100'
					style={{ left: contextMenu.x, top: contextMenu.y }}
					onClick={(e) => e.stopPropagation()}
				>
					<div className='flex flex-col py-1'>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">Actions</div>
						<button 
                            onClick={() => { handleReprocessSingle(contextMenu.targetId, 'encrypt'); setContextMenu(null) }}
                            className='flex items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors'
                        >
                            <Lock className="h-3 w-3"/>
							重做 (加密)
						</button>
                        <button 
                            onClick={() => { handleReprocessSingle(contextMenu.targetId, 'decrypt'); setContextMenu(null) }}
                            className='flex items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors'
                        >
                            <Unlock className="h-3 w-3"/>
							重做 (解密)
						</button>
                        <div className="my-1 h-px bg-slate-100"></div>
						<button 
                            onClick={() => { handleResetItem(contextMenu.targetId); setContextMenu(null) }}
                            className='flex items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 transition-colors'
                        >
                            <RefreshCw className="h-3 w-3"/>
							还原状态
						</button>
						<button 
                            onClick={() => { handleRemoveItem(contextMenu.targetId); setContextMenu(null) }}
                            className='flex items-center gap-2 px-3 py-2 text-left text-xs text-rose-500 hover:bg-rose-50 transition-colors'
                        >
                            <Trash2 className="h-3 w-3"/>
							删除图片
						</button>
					</div>
				</div>
			)}
		</div>
	)
}