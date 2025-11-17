import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PostCommentService, CreatePostCommentDTO } from '../../../core/services/post-comment.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-comment-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-form.component.html',
  styleUrls: ['./comment-form.component.scss']
})
export class CommentFormComponent implements OnInit {
  @Input() postId!: number;
  @Input() maxLength: number = 1000;
  @Input() placeholder: string = 'Escribe un comentario...';
  @Output() commentCreated = new EventEmitter<void>();

  comment: string = '';
  submitting: boolean = false;
  error: string = '';
  remainingChars: number = this.maxLength;

  constructor(
    private commentService: PostCommentService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.remainingChars = this.maxLength;
  }

  onInput(): void {
    this.remainingChars = this.maxLength - this.comment.length;
    this.error = '';
    
    // Validar contenido en tiempo real
    if (this.comment.trim().length > 0) {
      const validation = this.commentService.validateContent(this.comment);
      if (!validation.isValid && validation.reason) {
        this.error = validation.reason;
      }
    }
  }

  onSubmit(): void {
    if (!this.comment.trim()) {
      this.error = 'El comentario no puede estar vacío';
      return;
    }

    if (this.comment.length > this.maxLength) {
      this.error = `El comentario no puede exceder ${this.maxLength} caracteres`;
      return;
    }

    // Validar contenido inapropiado
    const validation = this.commentService.validateContent(this.comment);
    if (!validation.isValid) {
      this.error = validation.reason || 'El contenido contiene palabras inapropiadas';
      return;
    }

    if (!this.postId) {
      this.error = 'Se requiere un ID de publicación';
      return;
    }

    this.submitting = true;
    this.error = '';

    const data: CreatePostCommentDTO = {
      comment: this.comment.trim(),
      postId: this.postId
    };

    this.commentService.createComment(data).subscribe({
      next: () => {
        this.comment = '';
        this.remainingChars = this.maxLength;
        this.submitting = false;
        this.toastService.success('Éxito', 'Comentario publicado exitosamente');
        this.commentCreated.emit();
      },
      error: (err) => {
        this.submitting = false;
        const errorMsg = err?.error?.message || err?.message || 'Error al publicar el comentario';
        this.error = errorMsg;
        this.toastService.error('Error', errorMsg);
      }
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    // Permitir Ctrl+Enter para enviar
    if (event.ctrlKey && event.key === 'Enter') {
      this.onSubmit();
    }
  }
}

